const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: async (channel, ...args) => {
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  on: (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data)),
  // путь файла при перетаскивании в окно
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
});
