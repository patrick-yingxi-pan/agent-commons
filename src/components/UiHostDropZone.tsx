import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Paperclip } from 'lucide-react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { prepareUiHostFiles } from '../controller/imageAttachments.ts'
import type { UiHostFile } from '../lib/uiHostFs.ts'
import type { UiHostFsModule } from '../lib/useUiHostFs.ts'

/** Pick/drop local snapshots, then persist image bytes before attaching refs.
 * The whole selection belongs to the account that opened the picker. */
export function UiHostDropZone({
  accept,
  label,
  onPicked,
  hostFs,
}: {
  accept: 'image' | 'any'
  label: string
  onPicked: (f: UiHostFile) => void | Promise<void>
  hostFs: Pick<UiHostFsModule, 'pickUiHostFiles' | 'readDroppedFiles'>
}) {
  const [drag, setDrag] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const intake = useRef<AbortController | null>(null)
  useEffect(() => {
    const unsubscribe = onAccountSwitch(() => {
      intake.current?.abort()
      setImporting(false)
      setFailure(null)
    })
    return () => { unsubscribe(); intake.current?.abort() }
  }, [])
  const take = async (read: (signal: AbortSignal) => Promise<UiHostFile[]>) => {
    if (intake.current) return
    const controller = new AbortController()
    const issuedAccount = accountGeneration()
    intake.current = controller
    setImporting(true)
    setFailure(null)
    try {
      const files = await read(controller.signal)
      if (accountGeneration() !== issuedAccount) controller.abort()
      if (!controller.signal.aborted) {
        const prepared = await prepareUiHostFiles(files, controller.signal)
        if (!controller.signal.aborted) {
          // Queue the accepted selection before the first acknowledgement can
          // open a split pane and remount this picker. The session FIFO owns
          // commit/retry from here; closing the intake cannot cancel queued work.
          setImporting(false)
          const commits = prepared.map((file) => onPicked(file))
          await Promise.all(commits)
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'The selected items could not be read. Try again.')
    } finally {
      if (!controller.signal.aborted) setImporting(false)
      intake.current = null
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => void take((signal) => hostFs.pickUiHostFiles(accept, window, signal))}
        disabled={importing}
        aria-busy={importing}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const files = e.dataTransfer.files
          void take((signal) => hostFs.readDroppedFiles(files, accept, signal))
        }}
        className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center transition ${
          drag ? 'border-accent bg-accent-tint' : 'border-line-strong hover:bg-panel-2'
        }`}
      >
        {accept === 'image' ? (
          <ImageIcon size={18} className="mb-1 text-ink-faint" />
        ) : (
          <Paperclip size={18} className="mb-1 text-ink-faint" />
        )}
        <span className="text-[12px] font-medium text-ink">{label}</span>
        <span className="text-[11px] text-ink-faint">drag &amp; drop, or click to choose</span>
      </button>
      {importing && <p role="status" className="px-1 pt-1.5 text-[11px] leading-snug text-ink-soft">Importing selected files… Close this picker to cancel.</p>}
      {accept === 'any' && <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-faint">Documents (.pdf, .docx, .xlsx, .pptx): up to 8 MB each, 24 MB combined per selection. Only extracted text up to 64 KB per file is saved. PDFs: up to 100 pages; images, layout and OCR are not included. Excel: visible cell values only; formulas are not calculated. PowerPoint: slide text only; speaker notes and hidden slides are excluded.</p>}
      <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-faint">PNG, JPEG, GIF, WebP, BMP, ICO or SVG: up to 8 MB each, 24 MB per selection. Images are saved as a resized PNG of the first frame; ICO uses its largest image. SVG must be self-contained and static; scripts, animation and external resources are not supported.</p>
      {failure && <p role="alert" className="px-1 pt-1.5 text-[11px] leading-snug text-danger-text">{failure}</p>}
    </div>
  )
}
