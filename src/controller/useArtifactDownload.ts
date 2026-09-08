import { useEffect, useRef, useState } from 'react'
import { AccountSwitchedError, ApiRequestError, readArtifactDocumentExport } from '../api'
import { downloadText } from '../lib/downloadText.ts'

type Notice = { tone: 'status' | 'alert'; message: string }

/** One fresh, abortable read per activation. Never export the retained body
 * cache: a displayed document can be stale or its read grant revoked. */
export function useArtifactDownload(artifactId: string) {
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => {
    setBusy(false)
    setNotice(null)
    return () => { active.current?.abort(); active.current = null }
  }, [artifactId])

  const download = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
    setBusy(true)
    setNotice(null)
    try {
      const file = await readArtifactDocumentExport(artifactId, controller.signal)
      if (controller.signal.aborted || active.current !== controller) return
      if (file.artifactId !== artifactId) throw new Error('Unexpected document identity')
      downloadText(file)
      setNotice({ tone: 'status', message: 'Markdown download requested. It contains the latest saved text.' })
    } catch (error) {
      if (active.current !== controller || error instanceof AccountSwitchedError) return
      const message = timedOut ? 'The download request timed out. Try again.'
        : error instanceof ApiRequestError && error.status === 404 ? 'This document is no longer available to this account.'
        : error instanceof ApiRequestError && error.code === 'capability_unavailable' ? 'This artifact has no saved document content to download as Markdown.'
        : 'Could not download this document. Check your connection and try again.'
      setNotice({ tone: 'alert', message })
    } finally {
      clearTimeout(timer)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }
  return { download, busy, notice }
}
