'use strict'

const { contextBridge, ipcRenderer } = require('electron')
// Sandboxed preloads get Electron's restricted require, not arbitrary local
// CommonJS modules. These literals are therefore duplicated from the main-side
// registry and runtime.test.ts locks exact equality across the sandbox boundary.
const channels = Object.freeze({
  provision: 'agent-commons:credentials:provision',
  bind: 'agent-commons:credentials:bind',
  discard: 'agent-commons:credentials:discard',
  removeProvider: 'agent-commons:credentials:remove-provider',
})

// The main process adds this capability flag only after OS-backed encryption is
// available. A spoofed command-line flag gains no authority: every invocation is
// also origin/window-validated and requires the main-process vault.
if (process.argv.includes('--agent-commons-secure-credentials')) {
  contextBridge.exposeInMainWorld('agentCommonsDesktop', Object.freeze({
    credentials: Object.freeze({
      provision: (secret) => ipcRenderer.invoke(channels.provision, secret),
      bind: (reference, providerId) => ipcRenderer.invoke(channels.bind, reference, providerId),
      discard: (reference) => ipcRenderer.invoke(channels.discard, reference),
      removeProvider: (providerId) => ipcRenderer.invoke(channels.removeProvider, providerId),
    }),
  }))
}
