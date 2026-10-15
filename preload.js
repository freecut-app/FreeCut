// Ponte segura entre a interface e o processo principal
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('fc', {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, cb) => { const f = (e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.off(ch, f); },
  mediaUrl: p => 'freecut://app/media?p=' + encodeURIComponent(p),
  pathOf: file => webUtils.getPathForFile(file)
});
