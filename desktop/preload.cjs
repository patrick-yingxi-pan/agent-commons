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
  snapshotTree: 'agent-commons:local-folders:snapshot-tree',
  files: 'agent-commons:local-folders:files',
  file: 'agent-commons:local-folders:file',
  disconnect: 'agent-commons:local-folders:disconnect',
})
const localGitChannels = Object.freeze({
  list: 'agent-commons:local-git:list',
  connect: 'agent-commons:local-git:connect',
  snapshot: 'agent-commons:local-git:snapshot',
  review: 'agent-commons:local-git:review',
  files: 'agent-commons:local-git:files',
  file: 'agent-commons:local-git:file',
  untrackedFiles: 'agent-commons:local-git:untracked-files',
  untrackedFile: 'agent-commons:local-git:untracked-file',
  cancelUntrackedRead: 'agent-commons:local-git:cancel-untracked-read',
  disconnect: 'agent-commons:local-git:disconnect',
})
const mcpCredentialChannels = Object.freeze({
  provision: 'agent-commons:mcp-credentials:provision',
})
const mcpOAuthChannels = Object.freeze({
  start: 'agent-commons:mcp-oauth:start',
  review: 'agent-commons:mcp-oauth:review',
  authorize: 'agent-commons:mcp-oauth:authorize',
  reconcile: 'agent-commons:mcp-oauth:reconcile',
  cancel: 'agent-commons:mcp-oauth:cancel',
})
const mcpStdioChannels = Object.freeze({
  start: 'agent-commons:mcp-stdio:start',
  authorize: 'agent-commons:mcp-stdio:authorize',
  reconcile: 'agent-commons:mcp-stdio:reconcile',
  cancel: 'agent-commons:mcp-stdio:cancel',
})
const imageOcrChannels = Object.freeze({
  recognize: 'agent-commons:image-ocr:recognize',
  cancel: 'agent-commons:image-ocr:cancel',
})
const pdfOcrChannels = Object.freeze({
  recognize: 'agent-commons:pdf-ocr:recognize',
  cancel: 'agent-commons:pdf-ocr:cancel',
})
const MCP_CREDENTIAL_CAPABILITY = 'mcp-provision-v1'
const IMAGE_OCR_FAILURES = new Set(['no-text', 'invalid', 'too-large', 'unavailable', 'busy', 'cancelled', 'timeout'])
const PDF_OCR_FAILURES = new Set(['invalid', 'too-large', 'page-limit', 'protected', 'unavailable', 'busy', 'cancelled', 'timeout'])

function safePdfOcrResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unavailable' }
  const keys = Object.keys(value).sort().join(',')
  if (keys === 'status' && PDF_OCR_FAILURES.has(value.status)) return { status: value.status }
  if (!Number.isSafeInteger(value.pages) || value.pages < 1 || value.pages > 100 ||
      !Number.isSafeInteger(value.textPages) || value.textPages < 0 || value.textPages > value.pages) return { status: 'unavailable' }
  if (keys === 'pages,status,textPages' && value.status === 'no-text' && value.textPages === 0) {
    return { status: 'no-text', pages: value.pages, textPages: 0 }
  }
  if (keys === 'pages,status,text,textPages' && value.status === 'ready' && value.textPages > 0 &&
      safeImageOcrResult({ status: 'ready', text: value.text }).status === 'ready') {
    return { status: 'ready', text: value.text, pages: value.pages, textPages: value.textPages }
  }
  return { status: 'unavailable' }
}

function safeImageOcrResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unavailable' }
  const keys = Object.keys(value).sort().join(',')
  if (keys === 'status' && IMAGE_OCR_FAILURES.has(value.status)) return { status: value.status }
  if (keys === 'status,text' && value.status === 'ready' && typeof value.text === 'string' && value.text.trim() &&
      value.text.length <= 64 * 1024 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text)) {
    return { status: 'ready', text: value.text }
  }
  return { status: 'unavailable' }
}

async function invokeOcr(channel, ...args) {
  try { return await ipcRenderer.invoke(channel, ...args) }
  catch { return undefined }
}

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

async function invokeMcpOAuth(channel, request) {
  let reply
  try { reply = await ipcRenderer.invoke(channel, request) } catch {}
  const keys = reply && typeof reply === 'object' && !Array.isArray(reply) ? Object.keys(reply).sort().join(',') : ''
  if (keys === 'ok,value' && reply.ok === true) return reply.value
  const code = keys === 'error,ok' && reply.ok === false &&
    ['request', 'busy', 'stale', 'expired', 'cancelled', 'conflict', 'unavailable'].includes(reply.error) ? reply.error : 'unavailable'
  const error = new Error(`MCP sign-in could not be completed (${code}).`)
  error.code = code
  throw error
}

async function invokeMcpStdio(channel, request) {
  let reply
  try { reply = await ipcRenderer.invoke(channel, request) } catch {}
  const keys = reply && typeof reply === 'object' && !Array.isArray(reply) ? Object.keys(reply).sort().join(',') : ''
  if (keys === 'ok,value' && reply.ok === true) return reply.value
  const code = keys === 'error,ok' && reply.ok === false &&
    ['invalid', 'busy', 'stale', 'expired', 'cancelled', 'unavailable'].includes(reply.error) ? reply.error : 'unavailable'
  const error = new Error(`Local MCP setup could not be completed (${code}).`)
  error.code = code
  throw error
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
      ...(process.platform === 'darwin' ? { snapshotTree: (id, source) => invokeLocalFolder(localFolderChannels.snapshotTree, id, source) } : {}),
      ...(process.platform === 'darwin' ? {
        files: (id, source) => invokeLocalFolder(localFolderChannels.files, id, source),
        file: (id, selection, source) => invokeLocalFolder(localFolderChannels.file, id, selection, source),
      } : {}),
      disconnect: (id, source) => invokeLocalFolder(localFolderChannels.disconnect, id, source),
    }),
    ...(process.platform === 'darwin' ? { localGit: Object.freeze({
      list: (source) => invokeLocalFolder(localGitChannels.list, source),
      connect: (options, source) => invokeLocalFolder(localGitChannels.connect, options, source),
      snapshot: (id, source) => invokeLocalFolder(localGitChannels.snapshot, id, source),
      review: (id, source) => invokeLocalFolder(localGitChannels.review, id, source),
      files: (id, source) => invokeLocalFolder(localGitChannels.files, id, source),
      file: (id, selection, source) => invokeLocalFolder(localGitChannels.file, id, selection, source),
      untrackedFiles: (id, request, source) => invokeLocalFolder(localGitChannels.untrackedFiles, id, request, source),
      untrackedFile: (id, request, source) => invokeLocalFolder(localGitChannels.untrackedFile, id, request, source),
      cancelUntrackedRead: (id, request, source) => invokeLocalFolder(localGitChannels.cancelUntrackedRead, id, request, source),
      disconnect: (id, source) => invokeLocalFolder(localGitChannels.disconnect, id, source),
    }) } : {}),
  }),
  data: Object.freeze({
    createBackup: () => ipcRenderer.invoke(dataChannels.createBackup),
    getRecoveryStatus: () => ipcRenderer.invoke(dataChannels.getRecoveryStatus),
    revealBackups: () => ipcRenderer.invoke(dataChannels.revealBackups),
    restoreBackup: () => ipcRenderer.invoke(dataChannels.restoreBackup),
  }),
  ...(process.platform === 'darwin' ? { imageOcr: Object.freeze({
    recognize: async (operationId, png) => safeImageOcrResult(
      await invokeOcr(imageOcrChannels.recognize, operationId, png),
    ),
    cancel: async (operationId) => (await invokeOcr(imageOcrChannels.cancel, operationId)) === true,
  }) } : {}),
  ...(process.platform === 'darwin' ? { pdfOcr: Object.freeze({
    recognize: async (operationId, pdf) => safePdfOcrResult(
      await invokeOcr(pdfOcrChannels.recognize, operationId, pdf),
    ),
    cancel: async (operationId) => (await invokeOcr(pdfOcrChannels.cancel, operationId)) === true,
  }) } : {}),
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
if (process.argv.includes('--agent-commons-mcp-oauth=true')) {
  bridge.mcpOAuth = Object.freeze({
    start: request => invokeMcpOAuth(mcpOAuthChannels.start, request),
    review: request => invokeMcpOAuth(mcpOAuthChannels.review, request),
    authorize: request => invokeMcpOAuth(mcpOAuthChannels.authorize, request),
    reconcile: request => invokeMcpOAuth(mcpOAuthChannels.reconcile, request),
    cancel: request => invokeMcpOAuth(mcpOAuthChannels.cancel, request),
  })
}
if (process.platform === 'darwin' && process.argv.includes('--agent-commons-mcp-stdio=true')) {
  bridge.mcpStdio = Object.freeze({
    start: request => invokeMcpStdio(mcpStdioChannels.start, request),
    authorize: request => invokeMcpStdio(mcpStdioChannels.authorize, request),
    reconcile: request => invokeMcpStdio(mcpStdioChannels.reconcile, request),
    cancel: request => invokeMcpStdio(mcpStdioChannels.cancel, request),
  })
}
contextBridge.exposeInMainWorld('agentCommonsDesktop', Object.freeze(bridge))
