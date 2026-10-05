import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, RefreshCw, Sheet, Trash2 } from 'lucide-react'
import type { Attachment } from '../types'
import { PanelShell } from './PanelShell'
import { PhotoThumb } from './PhotoThumb'
import { parseFsRecentKey } from '../../contract/index'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { attachmentDocumentImport, attachmentImageRef, attachmentInputCopy, planAttachmentInput, type AttachmentInputStatus } from '../../contract/attachmentInput.ts'
import { documentImportCopy } from '../../contract/documentImport.mjs'
import { imageAssetContentUrl } from '../api/imageAssets'
import { isLocalTextFileName } from '../../contract/localTextFile.mjs'
import { documentFormatForName } from '../../contract/servedTextSnapshot.ts'
import { isServedImageFileName } from '../../contract/servedImageSnapshot.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import { refreshServedAttachment } from '../controller/servedAttachmentRefresh'

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']
const isImageLabel = (label: string) => IMG_EXTS.includes(label.split('.').pop()?.toLowerCase() ?? '')

/** Only saved asset content is preview authority. Legacy served attachments
 * require explicit Save snapshot instead of silently opening their source. */
function attachmentImageUrl(att: Attachment): string | undefined {
  const image = attachmentImageRef(att)
  return image ? imageAssetContentUrl(image.id) : undefined
}

interface AttachmentContent {
  body: string
  isImage: boolean
  imageUrl?: string
}

/** Text previews resolve only saved input, never reread a mutable source.
 * Missing content remains unavailable, never replaced by invented file content.
 * All rendered content is read-only; model availability is disclosed separately. */
function attachmentContent(att: Attachment): AttachmentContent {
  const isImage = !att.textSnapshot && (!!att.imageSnapshot || att.kind === 'photo' || isImageLabel(att.label))
  const imageUrl = attachmentImageUrl(att)
  if (isImage) return { body: '', isImage: true, imageUrl }
  if (att.textSnapshot) return { body: att.textSnapshot.text, isImage: false }
  if (att.source?.kind === 'ui-host') {
    return { body: att.previewText ?? '', isImage: false }
  }
  return { body: '', isImage: false }
}

/** Text and image saved copies share the same owner-only explicit refresh act. */
function ServedSnapshotControls({ item, onRefresh, refreshDisabled }: {
  item: Attachment
  onRefresh?: (attachment: Attachment) => void
  refreshDisabled: boolean
}) {
  const address = parseFsRecentKey(item.id)
  if (!address || address.sourceId !== item.source?.id ||
      item.source.kind !== (address.sourceId === 'cloud' ? 'cloud' : 'runner')) return null
  const image = isServedImageFileName(address.entryId)
  if (!image && !isLocalTextFileName(address.entryId.split('/').at(-1) ?? '') && !documentFormatForName(address.entryId)) return null
  const snapshot = item.imageSnapshot ?? item.textSnapshot
  return <div data-served-snapshot={snapshot ? 'saved' : 'missing'} className="mb-3 shrink-0 space-y-2">
    <p className="text-[11px] leading-snug text-ink-soft">
      {snapshot ? 'Saved copy. Source changes are used only after Refresh.'
        : image ? 'No saved image yet. Save a snapshot to preview and use this image as model input.'
          : 'No saved text yet. Save a snapshot to use this file as model input.'}
    </p>
    {onRefresh && <button type="button" disabled={refreshDisabled} onClick={() => onRefresh(item)}
      className={`${SECONDARY_BUTTON_CLASS} inline-flex items-center gap-1.5 px-2 py-1 text-[12px]`}>
      <RefreshCw size={13} />
      {snapshot ? 'Refresh saved copy' : 'Save snapshot'}
    </button>}
  </div>
}

/** Right-side panel that displays a group of file or photo attachments and lets
 *  the user preview / remove them. Opened by clicking a file/photo chip;
 *  `initialId` pre-selects the clicked item. */
export function AttachmentPanel({
  kind,
  items,
  allAttachments,
  initialId,
  onClose,
  onRemove,
  refreshSessionId,
  refreshDisabled = false,
}: {
  kind: 'file' | 'photo'
  items: Attachment[]
  allAttachments: Attachment[]
  initialId?: string
  onClose: () => void
  onRemove?: (id: string) => void
  refreshSessionId?: string
  refreshDisabled?: boolean
}) {
  const [selectedId, setSelectedId] = useState(initialId ?? items[0]?.id)

  useEffect(() => {
    if (!items.some((i) => i.id === selectedId)) setSelectedId(items[0]?.id)
  }, [items, selectedId])

  // Follow the chip the user picked without remounting the panel. Key this
  // synchronization only on `initialId`: `items` is a fresh filtered array each
  // render, so depending on it would clobber an in-panel selection every render.
  useEffect(() => {
    if (initialId) setSelectedId(initialId)
  }, [initialId])

  const selected = items.find((i) => i.id === selectedId) ?? items[0]

  return (
    <PanelShell
      icon={
        kind === 'photo' ? (
          <ImageIcon size={15} className="text-cap-photo" />
        ) : (
          <FileText size={15} className="text-cap-file" />
        )
      }
      title={kind === 'photo' ? 'Photos' : 'Files'}
      count={items.length}
      onClose={onClose}
    >
      {selected ? (
        kind === 'photo' ? (
          <PhotoBody
            item={selected}
            items={items}
            allAttachments={allAttachments}
            onSelect={setSelectedId}
            onRemove={onRemove}
            onRefresh={refreshSessionId ? (attachment) => { void refreshServedAttachment(refreshSessionId, attachment) } : undefined}
            refreshDisabled={refreshDisabled}
          />
        ) : (
          <FileBody
            item={selected}
            items={items}
            allAttachments={allAttachments}
            onSelect={setSelectedId}
            onRemove={onRemove}
            onRefresh={refreshSessionId ? (attachment) => { void refreshServedAttachment(refreshSessionId, attachment) } : undefined}
            refreshDisabled={refreshDisabled}
          />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-faint">No items</div>
      )}
    </PanelShell>
  )
}

function PhotoBody({
  item,
  items,
  allAttachments,
  onSelect,
  onRemove,
  onRefresh,
  refreshDisabled,
}: {
  item: Attachment
  items: Attachment[]
  allAttachments: Attachment[]
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onRefresh?: (attachment: Attachment) => void
  refreshDisabled: boolean
}) {
  const status = planAttachmentInput(allAttachments).find((entry) => entry.attachment.id === item.id)?.status ?? 'unavailable'
  const image = attachmentImageRef(item)
  return (
    <div data-attachment-preview={item.id} data-attachment-input-status={status} tabIndex={0} role="region" aria-label={`Preview ${item.label}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="grid shrink-0 grid-cols-3 gap-1.5 p-2.5">
        {items.map((p) => (
          <PhotoThumb
            key={p.id}
            id={p.id}
            src={attachmentImageUrl(p)}
            title={p.label}
            onClick={() => onSelect(p.id)}
            className={`aspect-square rounded-lg ring-2 transition ${
              p.id === item.id ? 'ring-accent' : 'ring-transparent hover:ring-line-strong'
            }`}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <PhotoThumb
          id={item.id}
          src={attachmentImageUrl(item)}
          showUnavailableLabel
          fit="contain"
          className="flex aspect-video w-full items-end rounded-lg shadow-inner"
        >
          <span className="relative z-10 m-2 rounded bg-black/30 px-1.5 py-0.5 text-[11px] font-medium text-on-solid/95">
            <span className="break-all">{item.label}</span>
          </span>
        </PhotoThumb>

        <p className="mt-2 text-[11px] leading-snug text-ink-faint">{attachmentInputCopy(status)}</p>
        {image && <p className="mt-1 text-[11px] leading-snug text-ink-faint">Saved {image.width} × {image.height} image. Imports save a PNG copy of the first frame (largest image for ICO).</p>}
        <div className="mt-2"><ServedSnapshotControls item={item} onRefresh={onRefresh} refreshDisabled={refreshDisabled} /></div>

        {onRemove && <button
          onClick={() => onRemove(item.id)}
          className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-faint transition hover:text-removed"
        >
          <Trash2 size={13} />
          Remove photo
        </button>}
      </div>
    </div>
  )
}

function FileBody({
  item,
  items,
  allAttachments,
  onSelect,
  onRemove,
  onRefresh,
  refreshDisabled,
}: {
  item: Attachment
  items: Attachment[]
  allAttachments: Attachment[]
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onRefresh?: (attachment: Attachment) => void
  refreshDisabled: boolean
}) {
  const content = attachmentContent(item)
  const documentImport = attachmentDocumentImport(item)
  const status: AttachmentInputStatus = planAttachmentInput(allAttachments).find((entry) => entry.attachment.id === item.id)?.status ?? 'unavailable'

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 overflow-y-auto p-2" style={{ maxHeight: '42%' }}>
        {items.map((f) => {
          const Icon = fileIcon(f.label)
          const active = f.id === item.id
          return (
            <div
              key={f.id}
              className={`group mb-1 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${
                active ? 'bg-surface ring-1 ring-line-strong' : 'hover:bg-surface/60'
              }`}
            >
              <button
                onClick={() => onSelect(f.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <Icon size={16} className="shrink-0 text-cap-file" />
                <span className="min-w-0 break-all text-[13px] font-medium text-ink">{f.label}</span>
              </button>
              {onRemove && <button
                onClick={() => onRemove(f.id)}
                title="Remove file"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-panel-2 hover:text-removed ${HOVER_REVEAL}`}
              >
                <Trash2 size={13} />
              </button>}
            </div>
          )
        })}
      </div>

      <div data-attachment-preview={item.id} data-attachment-input-status={status} tabIndex={0} role="region" aria-label={`Preview ${item.label}`} className="flex flex-1 flex-col overflow-y-auto border-t border-line bg-surface p-3">
        <p className="mb-2 shrink-0 text-[11px] leading-snug text-ink-soft">{attachmentInputCopy(status)}</p>
        <ServedSnapshotControls item={item} onRefresh={onRefresh} refreshDisabled={refreshDisabled} />
        {documentImport && <p data-document-import={documentImport.status} className="mb-2 shrink-0 text-[11px] leading-snug text-ink-soft">{documentImportCopy(documentImport)}</p>}
        {attachmentImageRef(item) && <p className="mb-2 shrink-0 text-[11px] leading-snug text-ink-soft">Durable resized first-frame PNG (largest image for ICO); the selected model must support vision to use this image.</p>}
        {content.isImage ? (
          <>
            <div className="mb-2 break-all text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Preview · {item.label}
            </div>
            <PhotoThumb id={item.id} src={content.imageUrl} showUnavailableLabel fit="contain" className="aspect-video w-full rounded-lg shadow-inner" />
          </>
        ) : content.body ? (
          <>
            <div className="mb-1.5 break-all text-[11px] font-medium uppercase tracking-wide text-ink-faint">Preview · {item.label}</div>
            <pre className="min-h-44 min-w-0 flex-1 overflow-auto break-words whitespace-pre-wrap rounded-md border border-line bg-canvas p-2 font-mono text-[12px] leading-relaxed text-ink">{content.body}</pre>
          </>
        ) : (
          <>
            <div className="mb-2 break-all text-[11px] font-medium uppercase tracking-wide text-ink-faint">Preview · {item.label}</div>
            <p className="text-[12px] leading-snug text-ink-soft">
              {attEmptyText(item) ? 'This text file is empty.' : 'Preview unavailable for this attachment.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function fileIcon(label: string) {
  const ext = label.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'csv' || ext === 'xlsx') return Sheet
  if (['png', 'jpg', 'jpeg', 'svg', 'gif'].includes(ext)) return ImageIcon
  return FileText
}

function attEmptyText(item: Attachment): boolean {
  return item.textSnapshot?.text === '' ||
    (item.source?.kind === 'ui-host' && typeof item.previewText === 'string' && item.previewText.length === 0)
}
