// The renderer's whole view of the app: tasks, settings, menus, app actions.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('clearday', {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (fields) => ipcRenderer.invoke('tasks:create', fields),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
    restore: (id) => ipcRenderer.invoke('tasks:restore', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: on('settings'),
  },
  menus: {
    sort: () => ipcRenderer.invoke('menu:sort'),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    revealData: () => ipcRenderer.invoke('app:reveal-data'),
    exportTasks: () => ipcRenderer.invoke('app:export'),
    resetBounds: () => ipcRenderer.invoke('app:reset-bounds'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  onPrefsOpen: on('prefs:open'),
  onNotesDir: on('notes:dir'),
  onClockResume: on('clock:resume'),
});
