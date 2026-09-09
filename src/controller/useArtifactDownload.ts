import { useEffect, useRef, useState } from 'react'
import { AccountSwitchedError, ApiRequestError, readArtifactExport } from '../api'
import type { ArtifactExportFormat } from '../../contract/index.ts'
import { downloadBlob } from '../lib/downloadText.ts'
import { decodeArtifactOfficeExport } from '../lib/artifactOfficeExport.ts'

type Notice = { tone: 'status' | 'alert'; message: string }

/** One fresh, abortable read per activation. Never export the retained body
 * cache: a displayed document can be stale or its read grant revoked. */
export function useArtifactDownload(artifactId: string, format: ArtifactExportFormat = 'markdown') {
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => {
    setBusy(false)
    setNotice(null)
    return () => { active.current?.abort(); active.current = null }
  }, [artifactId, format])

  const download = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
    setBusy(true)
    setNotice(null)
    try {
      const file = await readArtifactExport(artifactId, format, controller.signal)
      if (controller.signal.aborted || active.current !== controller) return
      if (file.artifactId !== artifactId) throw new Error('Unexpected document identity')
      if (format === 'xlsx' || format === 'pptx') {
        if (!('encoding' in file)) throw new Error('Unexpected Office export')
        downloadBlob(decodeArtifactOfficeExport(file, artifactId, format))
        setNotice({ tone: 'status', message: format === 'pptx' ? 'PowerPoint download requested. Long content can use continuation slides.' : 'XLSX download requested. Saved values are exported as text.' })
      } else {
        if (typeof file.content !== 'string' || file.mediaType !== 'text/markdown;charset=utf-8') throw new Error('Unexpected Markdown export')
        downloadBlob({ content: file.content, filename: file.filename, mediaType: file.mediaType })
        setNotice({ tone: 'status', message: 'Markdown download requested. It contains the latest saved text.' })
      }
    } catch (error) {
      if (active.current !== controller || error instanceof AccountSwitchedError) return
      const message = timedOut ? 'The download request timed out. Try again.'
        : error instanceof ApiRequestError && error.status === 404 ? `This ${format === 'xlsx' ? 'sheet' : format === 'pptx' ? 'slide deck' : 'document'} is no longer available to this account.`
        : error instanceof ApiRequestError && error.code === 'capability_unavailable' ? (format === 'pptx'
          ? 'This artifact has no PowerPoint-compatible saved slides. Unsupported control characters must be removed before export.'
          : `This artifact has no saved ${format === 'xlsx' ? 'sheet content to download as XLSX' : 'document content to download as Markdown'}.`)
        : `Could not download this ${format === 'xlsx' ? 'sheet' : format === 'pptx' ? 'slide deck' : 'document'}. Check your connection and try again.`
      setNotice({ tone: 'alert', message })
    } finally {
      clearTimeout(timer)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }
  return { download, busy, notice }
}
