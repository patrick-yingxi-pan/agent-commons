import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Sheet, Trash2 } from 'lucide-react'
import type { Attachment } from '../types'
import { PanelShell } from './PanelShell'
import { PhotoThumb } from './PhotoThumb'
import { useFsText, fsContentUrl } from '../api/hooks'
import { parseFsRecentKey } from '../../contract/index'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { attachmentInputCopy, planAttachmentInput, type AttachmentInputStatus } from '../../contract/attachmentInput.ts'
import { pdfImportCopy } from '../../contract/pdfImport.mjs'
import { imageAssetContentUrl } from '../api/imageAssets'

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']
const isImageLabel = (label: string) => IMG_EXTS.includes(label.split('.').pop()?.toLowerCase() ?? '')

/** Durable asset content or a served file endpoint; legacy local preview URLs
 * are not portable and never treated as a readable image. */
function attachmentImageUrl(att: Attachment): string | undefined {
  if (att.image) return imageAssetContentUrl(att.image.id)
  if (att.source?.kind === 'ui-host') return undefined
  const path = parseFsRecentKey(att.id)?.entryId
  if (att.source && path) return fsContentUrl(att.source.id, path)
  return undefined
}

interface AttachmentContent {
  loading: boolean
  body: string
  isImage: boolean
  imageUrl?: string
}

/** Resolve a picked preview snapshot or served text/image (cloud / runner).
 * Missing content remains unavailable, never replaced by invented file content.
 * All rendered content is read-only; model availability is disclosed separately. */
function useAttachmentContent(att: Attachment): AttachmentContent {
  const isImage = att.kind === 'photo' || isImageLabel(att.label)
  const imageUrl = attachmentImageUrl(att)
  const path = parseFsRecentKey(att.id)?.entryId
  const served = !!att.source && att.source.kind !== 'ui-host' && !!path && !isImage
  // Called unconditionally (enabled-gated) to honor the rules of hooks.
  const q = useFsText(att.source?.id ?? '', path ?? '', served)
  if (isImage) return { loading: false, body: '', isImage: true, imageUrl }
  if (att.source?.kind === 'ui-host') {
    return { loading: false, body: att.previewText ?? '', isImage: false }
  }
  if (served) {
    const body = q.data?.kind === 'text' ? q.data.text ?? '' : ''
    return { loading: q.status === 'loading', body, isImage: false }
  }
  return { loading: false, body: '', isImage: false }
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
}: {
  kind: 'file' | 'photo'
  items: Attachment[]
  allAttachments: Attachment[]
  initialId?: string
  onClose: () => void
  onRemove?: (id: string) => void
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
          />
        ) : (
          <FileBody
            item={selected}
            items={items}
            allAttachments={allAttachments}
            onSelect={setSelectedId}
            onRemove={onRemove}
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
}: {
  item: Attachment
  items: Attachment[]
  allAttachments: Attachment[]
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
}) {
  const status = planAttachmentInput(allAttachments).find((entry) => entry.attachment.id === item.id)?.status ?? 'unavailable'
  return (
    <div data-attachment-preview={item.id} data-attachment-input-status={status} className="flex flex-1 flex-col overflow-y-auto">
      <div className="grid grid-cols-3 gap-1.5 p-2.5">
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

      <div className="border-t border-line p-3">
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
        {item.image && <p className="mt-1 text-[11px] leading-snug text-ink-faint">Saved {item.image.width} × {item.image.height} image. Local imports save a PNG copy of the first frame.</p>}

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
}: {
  item: Attachment
  items: Attachment[]
  allAttachments: Attachment[]
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
}) {
  const content = useAttachmentContent(item)
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

      <div data-attachment-preview={item.id} data-attachment-input-status={status} className="flex flex-1 flex-col overflow-y-auto border-t border-line bg-surface p-3">
        <p className="mb-2 shrink-0 text-[11px] leading-snug text-ink-soft">{attachmentInputCopy(status)}</p>
        {item.documentImport && <p data-document-import={item.documentImport.status} className="mb-2 shrink-0 text-[11px] leading-snug text-ink-soft">{pdfImportCopy(item.documentImport)}</p>}
        {item.image && <p className="mb-2 shrink-0 text-[11px] leading-snug text-ink-soft">Durable resized first-frame PNG; the selected model must support vision to use this image.</p>}
        {content.isImage ? (
          <>
            <div className="mb-2 break-all text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Preview · {item.label}
            </div>
            <PhotoThumb id={item.id} src={content.imageUrl} showUnavailableLabel fit="contain" className="aspect-video w-full rounded-lg shadow-inner" />
          </>
        ) : content.loading ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-ink-faint">Loading…</div>
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
  return item.source?.kind === 'ui-host' && typeof item.previewText === 'string' && item.previewText.length === 0
}
