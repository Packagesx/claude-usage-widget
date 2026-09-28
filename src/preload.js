const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getInitial: () => ipcRenderer.invoke('get-initial'),
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
