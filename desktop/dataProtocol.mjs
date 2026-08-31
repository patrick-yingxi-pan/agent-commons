import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import { saveSnapshot } from '../server/persistence/backup.ts'

export const DATA_REQUEST = 'agent-commons:data-request'
export const DATA_RESULT = 'agent-commons:data-result'

const BACKUP_NAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{16}$/

/** Human-sortable and collision-resistant without revealing app state. */
export function desktopBackupName(now = new Date(), nonce = randomBytes(8).toString('hex')) {
  const stamp = now.toISOString().replaceAll(':', '-').replace('.', '-')
  const suffix = String(nonce).toLowerCase()
  const name = `backup-${stamp}-${suffix}`
  if (!BACKUP_NAME_PATTERN.test(name)) throw new Error('Could not create a safe backup name.')
  return name
}

export function isBackupMetadata(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.fileName === 'string' &&
    BACKUP_NAME_PATTERN.test(value.fileName.replace(/\.json$/, '')) &&
    value.fileName.endsWith('.json') &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)),
  )
}

/** Utility-process half: export only into the backend-configured managed
 * snapshots directory and return bounded metadata, never a filesystem path. */
export function installDataRuntime({
  parentPort = process.parentPort,
  save = (name) => saveSnapshot(name, { overwrite: false }),
  stat = statSync,
  now = () => new Date(),
  nonce = () => randomBytes(8).toString('hex'),
} = {}) {
  if (!parentPort) return null
  parentPort.on('message', (event) => {
    const message = event?.data
    if (!message || message.type !== DATA_REQUEST || !Number.isSafeInteger(message.requestId)) return
    const result = { type: DATA_RESULT, requestId: message.requestId }
    if (message.operation !== 'create-backup') {
      parentPort.postMessage({ ...result, ok: false, error: 'invalid_request' })
      return
    }
    try {
      const name = desktopBackupName(now(), nonce())
      const { to } = save(name)
      const details = stat(to)
      const backup = {
        fileName: basename(to),
        sizeBytes: details.size,
        createdAt: details.mtime.toISOString(),
      }
      if (!isBackupMetadata(backup)) throw new Error('invalid backup metadata')
      parentPort.postMessage({ ...result, ok: true, backup })
    } catch {
      parentPort.postMessage({ ...result, ok: false, error: 'backup_failed' })
    }
  })
  return {}
}

/** Main-process request client for the already-supervised backend. */
export function createDataBackendClient(child, { timeoutMs = 15_000 } = {}) {
  let sequence = 0
  let closed = false
  const pending = new Map()

  const onMessage = (message) => {
    if (message?.type !== DATA_RESULT || !Number.isSafeInteger(message.requestId)) return
    const request = pending.get(message.requestId)
    if (!request) return
    pending.delete(message.requestId)
    clearTimeout(request.timeout)
    if (message.ok === true && isBackupMetadata(message.backup)) request.resolve(message.backup)
    else request.reject(new Error('The local backend could not create the backup.'))
  }
  child.on('message', onMessage)

  return {
    createBackup() {
      if (closed) return Promise.reject(new Error('The local backend is not available.'))
      const requestId = (sequence += 1)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error('The local backend did not acknowledge the backup.'))
        }, timeoutMs)
        pending.set(requestId, { resolve, reject, timeout })
        child.postMessage({ type: DATA_REQUEST, requestId, operation: 'create-backup' })
      })
    },
    close() {
      if (closed) return
      closed = true
      child.off('message', onMessage)
      for (const entry of pending.values()) {
        clearTimeout(entry.timeout)
        entry.reject(new Error('The local backend stopped before creating the backup.'))
      }
      pending.clear()
    },
  }
}
