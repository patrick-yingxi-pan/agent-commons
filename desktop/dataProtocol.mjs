import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import { ensureDailyRecoverySnapshot, saveSnapshot } from '../server/persistence/backup.ts'

export const DATA_REQUEST = 'agent-commons:data-request'
export const DATA_RESULT = 'agent-commons:data-result'

const MANUAL_BACKUP_NAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{16}$/
const RECOVERY_BACKUP_NAME_PATTERN = /^recovery-\d{4}-\d{2}-\d{2}$/

/** Human-sortable and collision-resistant without revealing app state. */
export function desktopBackupName(now = new Date(), nonce = randomBytes(8).toString('hex')) {
  const stamp = now.toISOString().replaceAll(':', '-').replace('.', '-')
  const suffix = String(nonce).toLowerCase()
  const name = `backup-${stamp}-${suffix}`
  if (!MANUAL_BACKUP_NAME_PATTERN.test(name)) throw new Error('Could not create a safe backup name.')
  return name
}

/** Convert one managed backup filename into its path-free restore identity.
 * Exact filename families are the authority; arbitrary snapshot names, paths,
 * and non-JSON files never become native restore targets. */
export function managedBackupName(fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.json') || basename(fileName) !== fileName) return null
  const name = fileName.slice(0, -'.json'.length)
  return MANUAL_BACKUP_NAME_PATTERN.test(name) || RECOVERY_BACKUP_NAME_PATTERN.test(name) ? name : null
}

export function isBackupMetadata(value, kind = 'any') {
  const name = managedBackupName(value?.fileName) ?? ''
  const expectedName = kind === 'manual'
    ? MANUAL_BACKUP_NAME_PATTERN.test(name)
    : kind === 'recovery'
      ? RECOVERY_BACKUP_NAME_PATTERN.test(name)
      : MANUAL_BACKUP_NAME_PATTERN.test(name) || RECOVERY_BACKUP_NAME_PATTERN.test(name)
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.fileName === 'string' &&
    expectedName &&
    value.fileName.endsWith('.json') &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)),
  )
}

/** Validation is followed by projection: a future utility-process field cannot
 * widen the renderer bridge merely because the required metadata is present. */
export function boundedBackupMetadata(value, kind = 'any') {
  if (!isBackupMetadata(value, kind)) return null
  return {
    fileName: value.fileName,
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
  }
}

/** Collapse startup recovery to a bounded renderer-safe result. Failure detail
 * stays in shell diagnostics; a successful result may carry only the same
 * path-free metadata already admitted by the backup bridge. */
export function desktopRecoveryStatus(backup) {
  const bounded = boundedBackupMetadata(backup, 'recovery')
  return bounded
    ? { status: 'ready', backup: bounded }
    : { status: 'failed' }
}

/** Utility-process half: export only into the backend-configured managed
 * snapshots directory and return bounded metadata, never a filesystem path. */
export function installDataRuntime({
  parentPort = process.parentPort,
  save = (name) => saveSnapshot(name, { overwrite: false }),
  ensureRecovery = ensureDailyRecoverySnapshot,
  stat = statSync,
  now = () => new Date(),
  nonce = () => randomBytes(8).toString('hex'),
} = {}) {
  if (!parentPort) return null
  parentPort.on('message', (event) => {
    const message = event?.data
    if (!message || message.type !== DATA_REQUEST || !Number.isSafeInteger(message.requestId)) return
    const result = { type: DATA_RESULT, requestId: message.requestId }
    if (message.operation !== 'create-backup' && message.operation !== 'ensure-recovery-backup') {
      parentPort.postMessage({ ...result, ok: false, error: 'invalid_request' })
      return
    }
    try {
      const requestedAt = now()
      const kind = message.operation === 'create-backup' ? 'manual' : 'recovery'
      const { to } = kind === 'manual'
        ? save(desktopBackupName(requestedAt, nonce()))
        : ensureRecovery(requestedAt)
      const details = stat(to)
      const backup = {
        fileName: basename(to),
        sizeBytes: details.size,
        createdAt: details.mtime.toISOString(),
      }
      if (!isBackupMetadata(backup, kind)) throw new Error('invalid backup metadata')
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
    const backup = message.ok === true ? boundedBackupMetadata(message.backup, request.kind) : null
    if (backup) request.resolve(backup)
    else request.reject(new Error('The local backend could not create the backup.'))
  }
  child.on('message', onMessage)

  const request = (operation, kind) => {
    if (closed) return Promise.reject(new Error('The local backend is not available.'))
    const requestId = (sequence += 1)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('The local backend did not acknowledge the backup.'))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timeout, kind })
      child.postMessage({ type: DATA_REQUEST, requestId, operation })
    })
  }

  return {
    createBackup() {
      return request('create-backup', 'manual')
    },
    ensureRecoveryBackup() {
      return request('ensure-recovery-backup', 'recovery')
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
