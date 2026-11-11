const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('orpheus', {
  // window
  fullscreen: () => ipcRenderer.invoke('win:fs'),
  isFullscreen: () => ipcRenderer.invoke('win:isfs'),
  minimize: () => ipcRenderer.send('win:min'),
  quit: () => ipcRenderer.send('win:close'),
  onFullscreen: (cb) => ipcRenderer.on('fs', (_e, v) => cb(v)),
  // library (read straight from disk, folders are watched)
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  onUpdate: (cb) => ipcRenderer.on('lib:update', (_e, d) => cb(d)),
  ready: () => ipcRenderer.send('ui:ready'),
  onOpen: (cb) => ipcRenderer.on('open', (_e, list) => cb(list)),
  pickFolder: () => ipcRenderer.invoke('lib:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('lib:pickFiles'),
  addPaths: (list) => ipcRenderer.invoke('lib:addPaths', list),
  removeFolder: (d) => ipcRenderer.send('lib:removeFolder', d),
  ignore: (p) => ipcRenderer.send('lib:ignore', p),
  restore: () => ipcRenderer.invoke('lib:restore'),
  rescan: () => ipcRenderer.invoke('lib:rescan'),
  reveal: (p) => ipcRenderer.send('lib:reveal', p),
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
