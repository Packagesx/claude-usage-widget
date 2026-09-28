const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getInitial: () => ipcRenderer.invoke('get-initial'),
  setColor: (c) => ipcRenderer.send('set-color', c),
  setGlass: (g) => ipcRenderer.send('set-glass', g),
  onOpenColor: (cb) => ipcRenderer.on('open-color', () => cb()),
  setPref: (p) => ipcRenderer.send('set-pref', p),
  setTrayIcon: (d) => ipcRenderer.send('tray-icon', d),
  onToggleCollapse: (cb) => ipcRenderer.on('toggle-collapse', () => cb()),
  onLocked: (cb) => ipcRenderer.on('locked', (_e, v) => cb(v)),
  onRefit: (cb) => ipcRenderer.on('refit', () => cb()),
  onFont: (cb) => ipcRenderer.on('font', (_e, f) => cb(f)),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, p) => cb(p)),
  refresh: () => ipcRenderer.send('refresh'),
  login: () => ipcRenderer.send('login'),
  setSessionKey: (k) => ipcRenderer.invoke('set-session-key', k),
  hide: () => ipcRenderer.send('hide'),
  menu: () => ipcRenderer.send('menu'),
  openUsage: () => ipcRenderer.send('open-usage'),
  resize: (h) => ipcRenderer.send('resize', h),
  readClipboardKey: () => ipcRenderer.invoke('read-clipboard-key'),
  openClaudeBrowser: () => ipcRenderer.send('open-claude-browser'),
});
