// Screenshots of the real UI, for checking every look before a release and
// for the README.
//
// Loads the real renderer and preload with the demo board (seed.mjs), in a
// hidden window, with the glass fed frames cut from a still backdrop instead
// of the screen — the same trick as the token widget's shapeshots. The page
// gets the backdrop as its background and the pane is inset, so each shot
// looks like the window sitting on a desktop.
//
//   npm run shots           → tools/shots/out/*.png, plus a midnight check
//   npm run shots -- --docs → also copies the README images into docs/
import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSeed } from './seed.mjs';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const DOCS = path.join(REPO, 'docs');
const INSET = 40;   // desktop visible around the pane

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-shots-'));
process.env.CLEARDAY_USER_DATA = TMP;
writeSeed(TMP);
// After the env var is set: these resolve the user-data path when imported.
await import('../../src/main/paths.mjs');
const settings = await import('../../src/main/settings.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── IPC, as main.mjs registers it, minus the OS ─────────────────────────────
let page = { width: 0, height: 0 };
ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, p) => { settings.set(p || {}); return settings.all(); });
ipcMain.handle('menu:settings', () => {});
ipcMain.handle('menu:sort', () => {});
ipcMain.handle('glass:mode', () => 'native');
ipcMain.handle('glass:bounds', () => ({ bounds: { x: 0, y: 0, ...page }, scaleFactor: 2 }));
ipcMain.handle('glass:live', () => ({ cursor: { x: -1000, y: -1000 }, win: { x: 0, y: 0 } }));
ipcMain.on('glass:state', () => {});

function backdrop(w, h) {
  const png = path.join(TMP, 'backdrop.png');
  if (!fs.existsSync(png)) execFileSync('sips', ['-s', 'format', 'png', path.join(HERE, 'backdrop.webp'), '--out', png], { stdio: 'ignore' });
  const src = nativeImage.createFromPath(png);
  const { width: sw, height: sh } = src.getSize();
  // Cover-fit, centred
  const k = Math.max(w / sw, h / sh);
  const cw = Math.round(w / k), ch = Math.round(h / k);
  const img = src.crop({ x: Math.round((sw - cw) / 2), y: Math.round((sh - ch) / 2), width: cw, height: ch })
    .resize({ width: w, height: h, quality: 'best' });
  return {
    dataUrl: img.toDataURL(),
    // toBitmap is BGRA, the order the shader expects from the helper.
    frame: { width: w, height: h, displayId: '1', rect: { x: 0, y: 0, width: w, height: h }, pixels: new Uint8Array(img.toBitmap()) },
  };
}

async function shot(name, { theme, width, height, setup }) {
  writeSeed(TMP);
  await reloadStore();
  nativeTheme.themeSource = theme;
  page = { width: width + INSET * 2, height: height + INSET * 2 };
  const win = new BrowserWindow({
    ...page, show: false, useContentSize: true, transparent: true, frame: false,
    webPreferences: { preload: path.join(REPO, 'src', 'preload.cjs'), contextIsolation: true },
  });
  win.webContents.on('console-message', (e) => console.log(`[${name}] ${e.message}`));
  await win.loadFile(path.join(REPO, 'src', 'renderer', 'index.html'));
  const bg = backdrop(page.width, page.height);
  await win.webContents.insertCSS(`
    html { background: url("${bg.dataUrl}") 0 0 / 100% 100% no-repeat !important; }
    #pane { inset: ${INSET}px !important; overflow: hidden;
      box-shadow: inset 0 0 0 1px var(--window-hairline), 0 2px 6px rgba(0,0,0,.18), 0 18px 40px rgba(0,0,0,.30) !important; }
  `);
  const js = (code) => win.webContents.executeJavaScript(code);
  win.webContents.send('glass:frame', bg.frame);
  await sleep(600);
  if (setup) await setup(js);
  await sleep(700);
  await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`wrote tools/shots/out/${name}.png`);
  win.destroy();
}

// store.mjs caches the board; re-import a fresh copy for each shot.
async function reloadStore() {
  const fresh = await import(`../../src/main/store.mjs?${Date.now()}`);
  Object.assign(storeRef, fresh);
}
const storeRef = {};
ipcMain.handle('tasks:list', () => storeRef.list());
ipcMain.handle('tasks:create', (_e, f) => storeRef.create(f || {}));
ipcMain.handle('tasks:update', (_e, id, p) => storeRef.update(id, p || {}));
ipcMain.handle('tasks:remove', (_e, id) => storeRef.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => storeRef.restore(id));

const firstId = `cleardayDebug.state.tasks.values().next().value.id`;
const openNotes = (js) => js(`cleardayDebug.openNotes(${firstId}); document.activeElement.blur(); 1`);
const clickFirst = (sel) => (js) => js(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);

const SHOTS = {
  'expanded-dark': { theme: 'dark', width: 780, height: 560, setup: openNotes },
  'expanded-light': { theme: 'light', width: 780, height: 560, setup: openNotes },
  'compact-dark': { theme: 'dark', width: 420, height: 600 },
  'compact-light': { theme: 'light', width: 420, height: 600 },
  'compact-drawer-dark': { theme: 'dark', width: 420, height: 600, setup: (js) => js('cleardayDebug.setDrawer(true); 1') },
  'status-picker-dark': { theme: 'dark', width: 780, height: 560, setup: clickFirst('#sections .status-btn') },
  'priority-picker-light': { theme: 'light', width: 780, height: 560, setup: clickFirst('#sections [data-action="priority"]') },
  'editing-dark': { theme: 'dark', width: 780, height: 560, setup: (js) => js(`cleardayDebug.startEdit(${firstId}); 1`) },
};

// Each shot closes its window; that must not end the run.
app.on("window-all-closed", () => {});
app.whenReady().then(run).catch((e) => { console.error(e); app.exit(1); });

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, opts] of Object.entries(SHOTS)) await shot(name, opts);

  // Midnight: put the clock two seconds before it and watch the header.
  {
    const win = new BrowserWindow({ width: 600, height: 500, show: false,
      webPreferences: { preload: path.join(REPO, 'src', 'preload.cjs'), contextIsolation: true } });
    await win.loadFile(path.join(REPO, 'src', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    await sleep(400);
    const before = await js(`(() => {
      const t = new Date(); const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      window.cleardayClockOffset = m - t - 2000;
      cleardayDebug.updateDate();
      return [document.getElementById('date').textContent, cleardayDebug.state.tasks.size];
    })()`);
    await sleep(2600);
    const after = await js(`[document.getElementById('date').textContent, cleardayDebug.state.tasks.size]`);
    const ok = before[0] !== after[0] && before[1] === after[1];
    console.log(`midnight: ${before[0]} → ${after[0]}, tasks ${before[1]} → ${after[1]}  ${ok ? 'OK' : 'FAIL'}`);
    win.destroy();
  }

  if (process.argv.includes('--docs')) {
    fs.mkdirSync(DOCS, { recursive: true });
    for (const n of ['expanded-dark', 'expanded-light', 'compact-dark', 'compact-light']) {
      fs.copyFileSync(path.join(OUT, `${n}.png`), path.join(DOCS, `${n}.png`));
    }
    console.log('copied README images to docs/');
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  app.quit();
}
