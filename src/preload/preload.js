'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit surface exposed to the renderer. No Node access leaks.
contextBridge.exposeInMainWorld('netsplit', {
  connect: (id, options) => ipcRenderer.invoke('irc:connect', { id, options }),
  send: (id, command) => ipcRenderer.invoke('irc:send', { id, command }),
  disconnect: (id) => ipcRenderer.invoke('irc:disconnect', { id }),
  openExternal: (url) => ipcRenderer.invoke('irc:openExternal', { url }),
  systemIsDark: () => ipcRenderer.invoke('theme:systemIsDark'),
  focusWindow: () => ipcRenderer.invoke('window:focus'),

  // Socket lifecycle + raw lines from a connection.
  onEvent: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on('irc:event', listener);
    return () => ipcRenderer.removeListener('irc:event', listener);
  },

  // Native menu actions.
  onMenu: (channel, handler) => {
    const map = {
      addConnection: 'menu:addConnection',
      commandPalette: 'menu:commandPalette',
      demo: 'menu:demo',
    };
    const evt = map[channel];
    if (!evt) return () => {};
    const listener = () => handler();
    ipcRenderer.on(evt, listener);
    return () => ipcRenderer.removeListener(evt, listener);
  },
});
