// Drives native/glass-capture on macOS: tells it which part of the desktop
// sits behind the window, and turns its stdout back into frames for the
// renderer. Ported from the token widget's src/mac-capture.js; the difference
// is that ClearDay's window is resizable, so the captured area follows the
// window's size instead of a fixed table of shapes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, screen } from 'electron';

const MAGIC = 0x46534c47; // "GLSF"
const HEADER = 32;

// Desktop past the window's edge on every side: the rim refracts outward and
// the wide bloom blur reaches about this far.
const EDGE = 20;
// Extra desktop captured around the window, so a drag can move it this far
// before the capture has to be retargeted; the retarget is requested once the
// window comes within TILE_SLACK of the tile's edge, ahead of reaching it.
const TILE_MARGIN = { x: 160, y: 90 };
const TILE_SLACK = 40;
// Pixels per DIP. One even on Retina, as in the widget: the glass frosts
// everything it shows, and full density only costs bytes.
const TILE_SCALE = Number(process.env.GLASS_TILE_SCALE) || 1;
// The widget runs at 60; this window is about ten times its area, and frames
// only flow while the desktop behind it changes (a video, a scrolling page).
const FPS = 30;

const NO_PERMISSION = 3; // helper exit status, see glass-capture.swift
const PERMISSION_RETRY_MS = 4000;

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'glass-capture')
    : path.join(import.meta.dirname, '..', '..', 'bin', 'glass-capture');
}

export function available() {
  return process.platform === 'darwin' && fs.existsSync(helperPath());
}

// ~/Library/Logs/ClearDay/glass-capture.log
function logLine(line) {
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'glass-capture.log'), `${new Date().toISOString()} ${line}\n`);
  } catch (_) {}
}

export function start(onFrame) {
  let child = null;
  let asked = false; // the system prompt is raised at most once per launch
  let lastErr = '';
  let chunks = [];
  let queued = 0;
  let need = HEADER;
  let lastReq = '';
  let stopped = false;
  let paused = false;
  let lastBounds = null;
  let tile = null; // { display, x0, y0, x1, y1 } in global DIP
  let relaunch = null;

  function launch() {
    relaunch = null;
    if (stopped || paused) return;
    const args = asked ? [] : ['--request'];
    asked = true;
    const proc = spawn(helperPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    proc.stderr.on('data', (d) => {
      const msg = String(d).trim();
      if (msg !== lastErr) logLine(msg);
      lastErr = msg;
    });
    proc.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      queued += chunk.length;
      if (queued >= need) parse();
    });
    proc.on('exit', (code) => {
      if (child === proc) child = null;
      chunks = []; queued = 0; need = HEADER;
      lastReq = '';
      if (!stopped && !paused) relaunch = setTimeout(launch, code === NO_PERMISSION ? PERMISSION_RETRY_MS : 2000);
    });
    proc.stdin.on('error', () => {});
    if (lastBounds) track(lastBounds, true);
  }

  // Only the newest complete frame in a chunk is worth forwarding.
  function parse() {
    let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, queued);
    let latest = null;
    need = HEADER;
    while (buf.length >= HEADER) {
      if (buf.readUInt32LE(0) !== MAGIC) { buf = Buffer.alloc(0); break; } // lost sync
      const w = buf.readUInt32LE(4), h = buf.readUInt32LE(8);
      const size = HEADER + w * h * 4;
      if (buf.length < size) { need = size; break; }
      latest = {
        width: w,
        height: h,
        displayId: String(buf.readUInt32LE(12)),
        rect: {
          x: buf.readFloatLE(16), y: buf.readFloatLE(20),
          width: buf.readFloatLE(24), height: buf.readFloatLE(28),
        },
        pixels: buf.subarray(HEADER, size),
      };
      buf = buf.subarray(size);
    }
    chunks = buf.length ? [buf] : [];
    queued = buf.length;
    if (!latest) return;
    const disp = screen.getAllDisplays().find((d) => String(d.id) === latest.displayId);
    if (!disp) return;
    latest.rect.x += disp.bounds.x;
    latest.rect.y += disp.bounds.y;
    onFrame(latest);
  }

  function send(force) {
    const req = JSON.stringify({
      display: tile.display.id,
      x: tile.x0 - tile.display.bounds.x, y: tile.y0 - tile.display.bounds.y,
      w: tile.x1 - tile.x0, h: tile.y1 - tile.y0,
      scale: Math.min(TILE_SCALE, tile.display.scaleFactor),
      fps: FPS,
    });
    if (req === lastReq && !force) return;
    lastReq = req;
    child.stdin.write(req + '\n');
  }

  // Point the capture at the desktop behind the window. `force` re-sends an
  // unchanged rect: the helper ignores it while its stream runs, but uses it
  // to retry a start that failed for lack of permission.
  function track(bounds, force = false) {
    lastBounds = bounds;
    if (!child) return;
    const disp = screen.getDisplayMatching(bounds);
    const db = disp.bounds;
    const clampX = (v) => Math.min(db.x + db.width, Math.max(db.x, v));
    const clampY = (v) => Math.min(db.y + db.height, Math.max(db.y, v));
    const nx0 = clampX(bounds.x - EDGE), nx1 = clampX(bounds.x + bounds.width + EDGE);
    const ny0 = clampY(bounds.y - EDGE), ny1 = clampY(bounds.y + bounds.height + EDGE);
    if (nx1 <= nx0 || ny1 <= ny0) return;

    const fits = (lo, hi, t0, t1, d0, d1) =>
      (lo >= t0 + TILE_SLACK || t0 === d0) && (hi <= t1 - TILE_SLACK || t1 === d1) && lo >= t0 && hi <= t1;
    const ok = tile && tile.display.id === disp.id &&
      fits(nx0, nx1, tile.x0, tile.x1, db.x, db.x + db.width) &&
      fits(ny0, ny1, tile.y0, tile.y1, db.y, db.y + db.height);

    if (!ok) {
      tile = {
        display: disp,
        x0: clampX(nx0 - TILE_MARGIN.x), x1: clampX(nx1 + TILE_MARGIN.x),
        y0: clampY(ny0 - TILE_MARGIN.y), y1: clampY(ny1 + TILE_MARGIN.y),
      };
    }
    send(force);
  }

  // Hidden window: nothing to show, so the helper is let go entirely.
  function setActive(on) {
    if (on === !paused) return;
    paused = !on;
    if (paused) {
      clearTimeout(relaunch);
      if (child) child.kill();
    } else if (!child) {
      tile = null;
      launch();
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(relaunch);
    if (child) child.kill();
  }

  launch();
  return { track, stop, setActive };
}
