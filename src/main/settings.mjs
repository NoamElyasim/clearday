// Per-machine settings, kept in the OS user-data dir. Device-local on purpose:
// window bounds and Dock placement belong to this Mac, while tasks.json (see
// store.mjs) is what a future sync will share.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SORTS } from '../shared/model.mjs';

const FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  theme: 'system',      // 'system' | 'light' | 'dark'
  sort: 'default',      // see SORTS in model.mjs
  alwaysOnTop: false,
  showIn: 'dock',       // 'dock' | 'menubar'
  // On by default: a daily board you have to remember to open is one you stop
  // looking at. Turning it off in Preferences is written here and wins.
  openAtLogin: true,
  bounds: null,         // { x, y, width, height } in DIP, restored on launch
  // Preferences → Appearance
  bgOpacityLight: 0.35, // window background opacity, 0–1, per appearance
  bgOpacityDark: 0.45,
  textSize: 'medium',   // 'small' | 'medium' | 'large'
  blur: true,           // system blur of the desktop behind the window
  blurStyle: 'frosted', // 'subtle' | 'frosted' | 'vivid' (main.mjs MATERIALS)
  showWeekday: true,
  // Preferences → Behavior
  spellcheckNotes: true,
  sidePanel: 'todo',    // side tab showing: 'todo' | 'ongoing'
};

const fraction = (v) => typeof v === 'number' && v >= 0 && v <= 1;

const VALID = {
  theme: (v) => ['system', 'light', 'dark'].includes(v),
  sort: (v) => SORTS.includes(v),
  alwaysOnTop: (v) => typeof v === 'boolean',
  showIn: (v) => ['dock', 'menubar'].includes(v),
  openAtLogin: (v) => typeof v === 'boolean',
  bounds: (v) => v === null || (v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k]))),
  bgOpacityLight: fraction,
  bgOpacityDark: fraction,
  textSize: (v) => ['small', 'medium', 'large'].includes(v),
  blur: (v) => typeof v === 'boolean',
  blurStyle: (v) => ['subtle', 'frosted', 'vivid'].includes(v),
  showWeekday: (v) => typeof v === 'boolean',
  spellcheckNotes: (v) => typeof v === 'boolean',
  sidePanel: (v) => ['todo', 'ongoing'].includes(v),
};

let cache = null;

export function all() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
  // v0.2.0 saved its opacity defaults (0.70 / 0.75) along with everything
  // else. They were picked before the blur actually showed, and hide it, so
  // untouched ones move to the new defaults.
  if (!saved.settingsVersion) {
    if (saved.bgOpacityLight === 0.7) delete saved.bgOpacityLight;
    if (saved.bgOpacityDark === 0.75) delete saved.bgOpacityDark;
  }
  cache = { ...DEFAULTS, settingsVersion: 2 };
  for (const k of Object.keys(DEFAULTS)) if (k in saved && VALID[k](saved[k])) cache[k] = saved[k];
  return cache;
}

export function get(key) {
  return all()[key];
}

// Returns the keys that actually changed, so callers can react to just those.
export function set(patch) {
  const cur = all();
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS) || !VALID[k](v)) continue;
    if (JSON.stringify(cur[k]) === JSON.stringify(v)) continue;
    cur[k] = v;
    changed.push(k);
  }
  if (changed.length) write(cur);
  return changed;
}

function write(data) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // Write-then-rename: a half-written file would otherwise reset everything
    // on the next launch.
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('settings: could not save', e);
  }
}
