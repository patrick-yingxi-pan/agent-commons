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
  getRecoveryStatus: 'agent-commons:data:get-recovery-status',
  revealBackups: 'agent-commons:data:reveal-backups',
  restoreBackup: 'agent-commons:data:restore-backup',
})
const contextChannels = Object.freeze({
  pickFiles: 'agent-commons:context:pick-files',
  pickFolder: 'agent-commons:context:pick-folder',
})
const localFolderChannels = Object.freeze({
  list: 'agent-commons:local-folders:list',
  connect: 'agent-commons:local-folders:connect',
  snapshot: 'agent-commons:local-folders:snapshot',
  disconnect: 'agent-commons:local-folders:disconnect',
})
const localGitChannels = Object.freeze({
  list: 'agent-commons:local-git:list',
  connect: 'agent-commons:local-git:connect',
  snapshot: 'agent-commons:local-git:snapshot',
  review: 'agent-commons:local-git:review',
  disconnect: 'agent-commons:local-git:disconnect',
})
const mcpCredentialChannels = Object.freeze({
  provision: 'agent-commons:mcp-credentials:provision',
})
const MCP_CREDENTIAL_CAPABILITY = 'mcp-provision-v1'

// Do not forward main-process error objects or IPC rejection strings. Only the
// closed native outcome selects user guidance, keeping the renderer API intact.
async function invokeLocalFolder(channel, ...args) {
  const git = channel.startsWith('agent-commons:local-git:')
  const unavailable = git ? 'The repository is unavailable or has changed. Your saved snapshots have not been changed.'
    : 'The local folder is unavailable. Your saved snapshots have not been changed.'
  let reply
  try { reply = await ipcRenderer.invoke(channel, ...args) }
  catch { throw new Error(unavailable) }
  if (reply && typeof reply === 'object' && !Array.isArray(reply)) {
    const keys = Object.keys(reply).sort().join(',')
    if (keys === 'ok,value' && reply.ok === true) return reply.value
    if (keys === 'error,ok' && reply.ok === false) {
      if (reply.error === 'busy') throw new Error(git ? 'Repository reads are busy. Try again when the current reads finish.' : 'Local folder reads are busy. Try again when the current reads finish.')
      if (reply.error === 'limit-reached') throw new Error('This device has reached its local connection limit. Disconnect an unused connection first.')
    }
  }
  throw new Error(unavailable)
}

// Backup and user-mediated context selection are available in every desktop
// run. Credentials join only after OS-backed encryption is available. A
// spoofed command-line flag gains no authority: every invocation is also
// origin/window-validated and credential verbs require the main-process vault.
const bridge = {
  context: Object.freeze({
    pickFiles: (accept) => ipcRenderer.invoke(contextChannels.pickFiles, accept),
    pickFolder: () => ipcRenderer.invoke(contextChannels.pickFolder),
    localFolders: Object.freeze({
      list: (source) => invokeLocalFolder(localFolderChannels.list, source),
      connect: (options, source) => invokeLocalFolder(localFolderChannels.connect, options, source),
      snapshot: (id, source) => invokeLocalFolder(localFolderChannels.snapshot, id, source),
      disconnect: (id, source) => invokeLocalFolder(localFolderChannels.disconnect, id, source),
    }),
    ...(process.platform === 'darwin' ? { localGit: Object.freeze({
      list: (source) => invokeLocalFolder(localGitChannels.list, source),
      connect: (options, source) => invokeLocalFolder(localGitChannels.connect, options, source),
      snapshot: (id, source) => invokeLocalFolder(localGitChannels.snapshot, id, source),
      review: (id, source) => invokeLocalFolder(localGitChannels.review, id, source),
      disconnect: (id, source) => invokeLocalFolder(localGitChannels.disconnect, id, source),
    }) } : {}),
  }),
  data: Object.freeze({
    createBackup: () => ipcRenderer.invoke(dataChannels.createBackup),
    getRecoveryStatus: () => ipcRenderer.invoke(dataChannels.getRecoveryStatus),
    revealBackups: () => ipcRenderer.invoke(dataChannels.revealBackups),
    restoreBackup: () => ipcRenderer.invoke(dataChannels.restoreBackup),
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
if (process.argv.includes('--agent-commons-mcp-credentials')) {
  bridge.mcpCredentials = Object.freeze({
    provision: (binding, secret) => ipcRenderer.invoke(mcpCredentialChannels.provision, binding, secret, MCP_CREDENTIAL_CAPABILITY),
  })
}
contextBridge.exposeInMainWorld('agentCommonsDesktop', Object.freeze(bridge))
