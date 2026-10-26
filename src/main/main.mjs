// ClearDay main process: the window, its menus, the tray, login item, and the
// IPC the renderer uses to reach the task store and the glass capture.
import {
  app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, powerMonitor,
  screen, shell, systemPreferences, ipcMain,
} from 'electron';
import path from 'node:path';
import './paths.mjs';
import * as settings from './settings.mjs';
import * as store from './store.mjs';
import * as macCapture from './mac-capture.mjs';
import { SORTS, SORT_LABELS } from '../shared/model.mjs';

const DIR = import.meta.dirname;
const DEFAULT_SIZE = { width: 780, height: 560 };
const MIN_SIZE = { width: 320, height: 360 };

let win = null;
let tray = null;
let nativeGlass = null;
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

function boundsPayload() {
  const bounds = win.getBounds();
  const disp = screen.getDisplayMatching(bounds);
  return { bounds, scaleFactor: disp.scaleFactor };
}

function createWindow() {
  win = new BrowserWindow({
    ...restoreBounds(settings.get('bounds')),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    transparent: true,
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

  const sendBounds = (force = false) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('glass:bounds', boundsPayload());
    if (nativeGlass) nativeGlass.track(win.getBounds(), force === true);
  };
  win.on('move', sendBounds);
  win.on('resize', sendBounds);
  // The native shadow is computed from the window's pixels; after a resize it
  // still has the old outline until macOS is told to recompute it.
  win.on('resized', () => win.invalidateShadow());
  // Lets the renderer pin the glass to the pointer while the window is
  // dragged; see liveWindow() in glass.js.
  win.on('will-move', () => {
    const b = win.getBounds();
    win.webContents.send('glass:drag-start', { cursor: screen.getCursorScreenPoint(), win: { x: b.x, y: b.y } });
  });
  screen.on('display-metrics-changed', () => sendBounds(true));
  screen.on('display-added', () => sendBounds(true));
  screen.on('display-removed', () => sendBounds(true));

  win.on('show', () => nativeGlass?.setActive(true));
  win.on('hide', () => nativeGlass?.setActive(false));

  win.webContents.once('did-finish-load', () => {
    if (macCapture.available()) {
      nativeGlass = macCapture.start((frame) => {
        if (win && !win.isDestroyed()) win.webContents.send('glass:frame', frame);
      });
      if (!win.isVisible()) nativeGlass.setActive(false);
    }
    sendBounds(true);
    // Safety net: a failed capture start or a stream that ended on its own
    // would otherwise never be retried.
    setInterval(() => sendBounds(true), 2000);
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
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
  if (win && !win.isDestroyed() && keys.length) win.webContents.send('settings', settings.all());
}

function setSetting(patch) {
  applySetting(settings.set(patch));
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
    { type: 'separator' },
    ...settingsTemplate(),
  ])));
}

// ─── Menus ───────────────────────────────────────────────────────────────────
function settingsTemplate() {
  const radio = (label, key, value) => ({
    label, type: 'radio', checked: settings.get(key) === value,
    click: () => setSetting({ [key]: value }),
  });
  const items = [
    {
      label: 'Theme',
      submenu: [
        radio('Follow System', 'theme', 'system'),
        radio('Light', 'theme', 'light'),
        radio('Dark', 'theme', 'dark'),
      ],
    },
    { type: 'separator' },
    {
      label: 'Always on Top', type: 'checkbox', checked: settings.get('alwaysOnTop'),
      click: (item) => setSetting({ alwaysOnTop: item.checked }),
    },
    radio('Show in Dock', 'showIn', 'dock'),
    radio('Menu Bar Only', 'showIn', 'menubar'),
    {
      label: 'Launch at Login', type: 'checkbox', checked: settings.get('openAtLogin'),
      click: (item) => setSetting({ openAtLogin: item.checked }),
    },
  ];
  // The live glass needs Screen Recording, which macOS only grants from
  // System Settings. Until then the window uses the system blur instead.
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    items.push({ type: 'separator' }, {
      label: 'Allow Screen Recording for Live Glass…',
      click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'),
    });
  }
  items.push({ type: 'separator' }, { label: 'Quit ClearDay', accelerator: 'Cmd+Q', click: () => app.quit() });
  return items;
}

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

const popup = (template) => Menu.buildFromTemplate(template).popup({ window: win });
ipcMain.handle('menu:settings', () => popup(settingsTemplate()));
ipcMain.handle('menu:sort', () => popup(sortTemplate()));

ipcMain.handle('glass:bounds', () => boundsPayload());
ipcMain.handle('glass:mode', () => (macCapture.available() ? 'native' : 'none'));
// Pointer and window position in one round trip, read at call time. Polled
// only while the window is being dragged: macOS reports a dragged window's
// position about ten times a second, the pointer every time it is asked.
ipcMain.handle('glass:live', () => {
  const b = win && !win.isDestroyed() ? win.getBounds() : null;
  return { cursor: screen.getCursorScreenPoint(), win: b && { x: b.x, y: b.y } };
});
// 'live' once the shader is drawing captured frames; until then (no Screen
// Recording grant, no helper, no WebGL) the system blur stands in.
ipcMain.on('glass:state', (_e, state) => {
  if (!win || win.isDestroyed() || process.platform !== 'darwin') return;
  win.setVibrancy(state === 'live' ? null : 'under-window');
});

// ─── Startup ─────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; store.flush(); });
  app.on('will-quit', () => nativeGlass?.stop());

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
