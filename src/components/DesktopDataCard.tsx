import { useState } from 'react'
import { createDesktopBackup, desktopDataAvailable, revealDesktopBackups } from '../api'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button'
import { ResourcePageSection as FoldSection } from './ResourcePage'

type Notice = { tone: 'status' | 'alert'; message: string }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Electron-only data safety. The native bridge owns every filesystem detail;
 * this component sees only bounded backup metadata and acknowledgement. */
export function DesktopDataCard() {
  const [busy, setBusy] = useState<'backup' | 'reveal' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  if (!desktopDataAvailable()) return null

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

  return (
    <FoldSection
      title="Local backups"
      summary="Daily recovery and portable copies of your on-device workspace."
      persist={false}
    >
      <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center">
        <div className="min-w-0">
          <p className="text-[12px] text-ink-faint">
            Seven daily recovery copies are kept automatically. Backups you create remain until deleted.
            Both contain private app data but no provider API keys.
          </p>
          {notice && (
            <p
              role={notice.tone}
              aria-live={notice.tone === 'status' ? 'polite' : 'assertive'}
              className={`mt-2 break-words text-[12px] ${notice.tone === 'alert' ? 'text-danger' : 'text-ok'}`}
            >
              {notice.message}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 @xl:justify-end">
          <button
            type="button"
            onClick={() => void revealBackups()}
            disabled={busy !== null}
            className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy === 'reveal' ? 'Opening…' : 'Show backups'}
          </button>
          <button
            type="button"
            onClick={() => void createBackup()}
            disabled={busy !== null}
            className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>
    </FoldSection>
  )
}
