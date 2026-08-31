'use strict'

const { contextBridge, ipcRenderer } = require('electron')
// Sandboxed preloads get Electron's restricted require, not arbitrary local
// CommonJS modules. These literals are therefore duplicated from the main-side
// registry and runtime.test.ts locks exact equality across the sandbox boundary.
const credentialChannels = Object.freeze({
  provision: 'agent-commons:credentials:provision',
  bind: 'agent-commons:credentials:bind',
  discard: 'agent-commons:credentials:discard',
  removeProvider: 'agent-commons:credentials:remove-provider',
})
const dataChannels = Object.freeze({
  createBackup: 'agent-commons:data:create-backup',
  revealBackups: 'agent-commons:data:reveal-backups',
})
const contextChannels = Object.freeze({
  pickFiles: 'agent-commons:context:pick-files',
  pickFolder: 'agent-commons:context:pick-folder',
})

// Backup and user-mediated context selection are available in every desktop
// run. Credentials join only after OS-backed encryption is available. A
// spoofed command-line flag gains no authority: every invocation is also
// origin/window-validated and credential verbs require the main-process vault.
const bridge = {
  context: Object.freeze({
    pickFiles: (accept) => ipcRenderer.invoke(contextChannels.pickFiles, accept),
    pickFolder: () => ipcRenderer.invoke(contextChannels.pickFolder),
  }),
  data: Object.freeze({
    createBackup: () => ipcRenderer.invoke(dataChannels.createBackup),
    revealBackups: () => ipcRenderer.invoke(dataChannels.revealBackups),
  }),
}
if (process.argv.includes('--agent-commons-secure-credentials')) {
  bridge.credentials = Object.freeze({
    provision: (secret) => ipcRenderer.invoke(credentialChannels.provision, secret),
    bind: (reference, providerId) => ipcRenderer.invoke(credentialChannels.bind, reference, providerId),
    discard: (reference) => ipcRenderer.invoke(credentialChannels.discard, reference),
    removeProvider: (providerId) => ipcRenderer.invoke(credentialChannels.removeProvider, providerId),
  })
}
contextBridge.exposeInMainWorld('agentCommonsDesktop', Object.freeze(bridge))
