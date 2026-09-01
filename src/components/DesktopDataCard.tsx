import { useEffect, useState } from 'react'
import {
  createDesktopBackup,
  desktopDataAvailable,
  getDesktopRecoveryStatus,
  restoreDesktopBackup,
  revealDesktopBackups,
} from '../api'
import type { DesktopRecoveryStatus } from '../api'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button'
import { ResourcePageSection as FoldSection } from './ResourcePage'

type Notice = { tone: 'status' | 'alert'; message: string }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Electron-only data safety. The native bridge owns every filesystem detail;
 * this component sees only bounded backup metadata and path-free outcomes. */
export function DesktopDataCard() {
  const available = desktopDataAvailable()
  const [busy, setBusy] = useState<'backup' | 'restore' | 'reveal' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [recovery, setRecovery] = useState<DesktopRecoveryStatus | { status: 'checking' }>({ status: 'checking' })

  useEffect(() => {
    if (!available) return
    let current = true
    void getDesktopRecoveryStatus()
      .then((status) => { if (current) setRecovery(status) })
      .catch(() => { if (current) setRecovery({ status: 'failed' }) })
    return () => { current = false }
  }, [available])

  if (!available) return null

  const createBackup = async () => {
    setBusy('backup')
    setNotice(null)
    try {
      const backup = await createDesktopBackup()
      setNotice({
        tone: 'status',
        message: `Saved ${backup.fileName} · ${formatBytes(backup.sizeBytes)}`,
      })
    } catch {
      setNotice({ tone: 'alert', message: 'The backup could not be created. Your app data was not changed.' })
    } finally {
      setBusy(null)
    }
  }

  const revealBackups = async () => {
    setBusy('reveal')
    try {
      await revealDesktopBackups()
    } catch {
      setNotice({ tone: 'alert', message: 'The backup folder could not be opened.' })
    } finally {
      setBusy(null)
    }
  }

  const restoreBackup = async () => {
    setBusy('restore')
    try {
      const result = await restoreDesktopBackup()
      if (result.status === 'restarting') {
        setNotice({ tone: 'status', message: 'Backup restored. Restarting Agent Commons…' })
      }
    } catch {
      setNotice({ tone: 'alert', message: 'The backup could not be restored. Your current app data was not changed.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <FoldSection
      title="Local backups"
      summary="Daily recovery and portable copies of your on-device workspace."
      persist={false}
    >
      <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center">
        <div className="min-w-0">
          <p className="text-[12px] text-ink-faint">
            Agent Commons keeps the newest seven automatic daily recovery copies when storage is available.
            Backups you create remain until deleted.
            Restoring first saves a fresh safety copy, replaces local workspace data, and restarts the app.
            Backups contain private app data but no provider API keys.
          </p>
          {recovery.status === 'checking' && (
            <p role="status" aria-live="polite" className="mt-2 text-[12px] text-ink-faint">
              Checking today’s automatic recovery copy…
            </p>
          )}
          {recovery.status === 'ready' && (
            <p role="status" aria-live="polite" className="mt-2 break-words text-[12px] text-ok-text">
              Today’s automatic recovery copy is ready · {recovery.backup.fileName} · {formatBytes(recovery.backup.sizeBytes)}
            </p>
          )}
          {recovery.status === 'failed' && (
            <p role="alert" aria-live="assertive" className="mt-2 text-[12px] text-danger-text">
              Today’s automatic recovery copy couldn’t be confirmed. Back up now to protect current work;
              Agent Commons will retry automatically next launch.
            </p>
          )}
          {notice && (
            <p
              role={notice.tone}
              aria-live={notice.tone === 'status' ? 'polite' : 'assertive'}
              className={`mt-2 break-words text-[12px] ${notice.tone === 'alert' ? 'text-danger-text' : 'text-ok-text'}`}
            >
              {notice.message}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 items-center gap-2 @xl:flex @xl:flex-wrap @xl:justify-end">
          <button
            type="button"
            onClick={() => void revealBackups()}
            disabled={busy !== null}
            className={`${SECONDARY_BUTTON_CLASS} w-full px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50 @xl:w-auto`}
          >
            {busy === 'reveal' ? 'Opening…' : 'Show backups'}
          </button>
          <button
            type="button"
            onClick={() => void restoreBackup()}
            disabled={busy !== null}
            className={`${SECONDARY_BUTTON_CLASS} w-full px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50 @xl:w-auto`}
          >
            {busy === 'restore' ? 'Preparing restore…' : 'Restore backup…'}
          </button>
          <button
            type="button"
            onClick={() => void createBackup()}
            disabled={busy !== null}
            className={`${SOFT_BUTTON_CLASS} col-span-2 w-full px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50 @xl:w-auto`}
          >
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>
    </FoldSection>
  )
}
