// ClearDay main process: the window, the tray, the login item, the
// right-click menu, and the IPC the renderer uses to reach the task store and
// the app's settings.
import {
  app, BrowserWindow, Menu, Tray, dialog, nativeImage, nativeTheme, powerMonitor,
  screen, shell, ipcMain,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import './paths.mjs';
import * as settings from './settings.mjs';
import * as store from './store.mjs';
import { buildTemplate } from './context-menu.mjs';
import { SORTS, SORT_LABELS, SCHEMA_VERSION } from '../shared/model.mjs';

const DIR = import.meta.dirname;
const DEFAULT_SIZE = { width: 780, height: 560 };
const MIN_SIZE = { width: 320, height: 360 };
// Preferences → Text size, as page zoom so every part of the UI scales together.
const ZOOM = { small: 0.9, medium: 1, large: 1.12 };

let win = null;
let tray = null;
let quitting = false;

// ─── Window placement ────────────────────────────────────────────────────────
function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    ...DEFAULT_SIZE,
    x: Math.round(workArea.x + workArea.width - DEFAULT_SIZE.width - 40),
    y: Math.round(workArea.y + 40),
  };
}

// A saved position can point off-screen after a monitor is unplugged, which
// would leave the board invisible with no way to drag it back. Keep at least
// a strip of the header on a display, and the size within the display.
function restoreBounds(saved) {
  if (!saved) return defaultBounds();
  const area = screen.getDisplayMatching(saved).workArea;
  const width = Math.min(Math.max(saved.width, MIN_SIZE.width), area.width);
  const height = Math.min(Math.max(saved.height, MIN_SIZE.height), area.height);
  const visible = saved.x + width > area.x + 60 && saved.x < area.x + area.width - 60 &&
                  saved.y >= area.y - 10 && saved.y < area.y + area.height - 40;
  return visible ? { x: saved.x, y: saved.y, width, height } : defaultBounds();
}

function createWindow() {
  win = new BrowserWindow({
    ...restoreBounds(settings.get('bounds')),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    transparent: true,
    // The desktop behind the window is blurred by macOS; the board's own
    // background (theme.css, opacity from Preferences) is drawn over it.
    vibrancy: 'under-window',
    visualEffectState: 'active',
    resizable: true,
    hasShadow: true,
    show: false,
    alwaysOnTop: settings.get('alwaysOnTop'),
    fullscreenable: false,
    title: 'ClearDay',
    webPreferences: {
      preload: path.join(DIR, '..', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (settings.get('alwaysOnTop')) win.setAlwaysOnTop(true, 'floating');

  win.loadFile(path.join(DIR, '..', 'renderer', 'index.html'));
  // Renderer errors would otherwise vanish in a dev run.
  if (!app.isPackaged) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  }
  win.once('ready-to-show', () => win.show());

  // Hide rather than close: ⌘W, or the window's own close, keeps the board a
  // click away in the Dock or menu bar.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) settings.set({ bounds: win.getBounds() });
    }, 400);
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  // The native shadow is computed from the window's pixels; after a resize it
  // still has the old outline until macOS is told to recompute it.
  win.on('resized', () => win.invalidateShadow());

  win.webContents.on('context-menu', showContextMenu);
  win.webContents.on('did-finish-load', applyTextSize);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
}

// ─── Right-click menu ────────────────────────────────────────────────────────
// The renderer notes what was right-clicked (window.cleardayContext, set in
// its own contextmenu handler, which runs before this event) so the menu knows
// whether it is in a note, and whose.
async function showContextMenu(_e, params) {
  const wc = win.webContents;
  let ctx = null;
  try { ctx = await wc.executeJavaScript('window.cleardayContext || null'); } catch (_) {}
  ctx = ctx || { field: params.isEditable ? 'input' : null };
  const template = buildTemplate(params, { ...ctx, spellcheck: settings.get('spellcheckNotes') }, {
    replace: (word) => wc.replaceMisspelling(word),
    learn: (word) => wc.session.addWordToSpellCheckerDictionary(word),
    lookUp: () => wc.showDefinitionForSelection(),
    setDir: (dir) => wc.send('notes:dir', { id: ctx.taskId, dir }),
    setSpellcheck: (on) => setSetting({ spellcheckNotes: on }),
  });
  if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
}

// ─── Settings that act on the app ────────────────────────────────────────────
function applyTheme() {
  nativeTheme.themeSource = settings.get('theme');
}

function applyLoginItem() {
  // A dev run would register the bare Electron binary as a login item.
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings.get('openAtLogin') });
  } catch (e) {
    console.error('could not set login item', e);
  }
}

function applyTextSize() {
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(ZOOM[settings.get('textSize')] || 1);
}

function applyAlwaysOnTop() {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.get('alwaysOnTop'), 'floating');
}

// Menu-bar-only hides the Dock icon and puts a tray icon in its place; Dock
// mode is the reverse. One of the two is always there to bring the window back.
async function applyShowIn() {
  if (process.platform !== 'darwin') return;
  if (settings.get('showIn') === 'menubar') {
    if (!tray) createTray();
    app.dock?.hide();
  } else {
    await app.dock?.show();
    if (tray) { tray.destroy(); tray = null; }
  }
}

function applySetting(keys) {
  if (keys.includes('theme')) applyTheme();
  if (keys.includes('openAtLogin')) applyLoginItem();
  if (keys.includes('alwaysOnTop')) applyAlwaysOnTop();
  if (keys.includes('showIn')) applyShowIn();
  if (keys.includes('textSize')) applyTextSize();
  if (win && !win.isDestroyed() && keys.length) win.webContents.send('settings', settings.all());
}

function setSetting(patch) {
  applySetting(settings.set(patch));
}

function openPreferences() {
  showWindow();
  win?.webContents.send('prefs:open');
}

// ─── Tray ────────────────────────────────────────────────────────────────────
// Drawn here rather than shipped as an image: a round status button and two
// task lines, as a template image so macOS tints it for light and dark bars.
function trayImage() {
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const S = 18 * scale;
    const buf = Buffer.alloc(S * S * 4);
    const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = (x + 0.5) / scale, fy = (y + 0.5) / scale;
        let a = 0;
        for (const cy of [5, 9, 13]) {
          const ring = Math.abs(Math.hypot(fx - 4, fy - cy) - 1.6) - 0.65;
          const lineHalf = cy === 9 ? 4.5 : 5.5;
          const qx = Math.abs(fx - (8.5 + lineHalf)) - lineHalf + 0.9, qy = Math.abs(fy - cy) - 0.9 + 0.9;
          const line = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.9;
          a = Math.max(a, cover(ring * scale), cover(line * scale));
        }
        buf[(y * S + x) * 4 + 3] = Math.round(a * 255); // BGRA, black with alpha
      }
    }
    img.addRepresentation({ scaleFactor: scale, width: S, height: S, buffer: buf });
  }
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('ClearDay');
  tray.on('click', () => {
    if (win.isVisible() && win.isFocused()) win.hide();
    else showWindow();
  });
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Show ClearDay', click: showWindow },
    { label: 'Preferences…', click: openPreferences },
    { type: 'separator' },
    { label: 'Quit ClearDay', click: () => app.quit() },
  ])));
}

// ─── Menus ───────────────────────────────────────────────────────────────────
function sortTemplate() {
  return SORTS.map((s) => ({
    label: SORT_LABELS[s], type: 'radio', checked: settings.get('sort') === s,
    click: () => setSetting({ sort: s }),
  }));
}

// The app menu mostly exists for its key equivalents: without an Edit menu,
// ⌘C / ⌘V / ⌘A do nothing in text fields on macOS.
function appMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'ClearDay',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: openPreferences },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { label: 'Close', accelerator: 'Cmd+W', click: () => win?.hide() }],
    },
  ]);
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('tasks:list', () => store.list());
ipcMain.handle('tasks:create', (_e, fields) => store.create(fields || {}));
ipcMain.handle('tasks:update', (_e, id, patch) => store.update(id, patch || {}));
ipcMain.handle('tasks:remove', (_e, id) => store.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => store.restore(id));

ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, patch) => { setSetting(patch || {}); return settings.all(); });

ipcMain.handle('menu:sort', () => Menu.buildFromTemplate(sortTemplate()).popup({ window: win }));

ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataFile: store.FILE_PATH }));
ipcMain.handle('app:reveal-data', () => { store.flush(); shell.showItemInFolder(store.FILE_PATH); });
ipcMain.handle('app:export', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export tasks',
    defaultPath: path.join(app.getPath('downloads'), `ClearDay tasks ${day}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  const out = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tasks: store.list() };
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
  return filePath;
});
ipcMain.handle('app:reset-bounds', () => {
  const b = defaultBounds();
  win?.setBounds(b);
  settings.set({ bounds: b });
});
ipcMain.handle('app:quit', () => app.quit());

// ─── Startup ─────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; store.flush(); });

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: 'ClearDay', applicationVersion: app.getVersion() });
    Menu.setApplicationMenu(appMenu());
    applyTheme();
    applyLoginItem();
    await applyShowIn();
    createWindow();
    // The header date has to roll over after a night asleep, when no timer
    // fired at midnight.
    powerMonitor.on('resume', () => win?.webContents.send('clock:resume'));
    powerMonitor.on('unlock-screen', () => win?.webContents.send('clock:resume'));
  });
}
