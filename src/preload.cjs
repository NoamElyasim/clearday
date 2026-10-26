// The renderer's whole view of the app: tasks, settings, menus, glass.
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
    settings: () => ipcRenderer.invoke('menu:settings'),
    sort: () => ipcRenderer.invoke('menu:sort'),
  },
  onClockResume: on('clock:resume'),
  glass: {
    mode: () => ipcRenderer.invoke('glass:mode'),
    getBounds: () => ipcRenderer.invoke('glass:bounds'),
    livePosition: () => ipcRenderer.invoke('glass:live'),
    onBounds: on('glass:bounds'),
    onDragStart: on('glass:drag-start'),
    onFrame: on('glass:frame'),
    setState: (state) => ipcRenderer.send('glass:state', state),
  },
});
