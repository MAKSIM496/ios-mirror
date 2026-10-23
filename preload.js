const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirror', {
  info: () => ipcRenderer.invoke('info'),
  sources: () => ipcRenderer.invoke('sources'),
  receiver: (on) => ipcRenderer.invoke('receiver', on),
  save: (kind, data) => ipcRenderer.invoke('save', { kind, data }),
  onReceiverState: (cb) => ipcRenderer.on('receiver-state', (_e, v) => cb(v)),
});
