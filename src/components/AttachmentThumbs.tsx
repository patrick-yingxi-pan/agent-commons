import { Files } from 'lucide-react'
import type { Attachment } from '../types'
import { gradientFor } from '../lib/thumbs'

/** File/photo attachments rendered as thumbnails, grouped one tile per type.
 *  Each tile is clickable and opens the right-side preview / edit panel. */
export function AttachmentThumbs({
  attachments,
  onOpen,
  activeKind,
}: {
  attachments: Attachment[]
  onOpen: (kind: 'file' | 'photo') => void
  activeKind: 'file' | 'photo' | null
}) {
  const photos = attachments.filter((a) => a.kind === 'photo')
  const files = attachments.filter((a) => a.kind === 'file')

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2">
      {photos.length > 0 && (
        <GroupTile active={activeKind === 'photo'} onClick={() => onOpen('photo')} title="View & edit photos">
          <span
            className="relative block h-8"
            style={{ width: 32 + Math.min(photos.length - 1, 2) * 7 }}
          >
            {photos.slice(0, 3).map((p, i) => (
              <span
                key={p.id}
                className={`absolute top-0 h-8 w-8 rounded-md ring-2 ring-surface ${gradientFor(p.id)}`}
                style={{ left: i * 7, zIndex: 3 - i }}
              />
            ))}
          </span>
          <Label title="Photos" count={photos.length} />
        </GroupTile>
      )}

      {files.length > 0 && (
        <GroupTile active={activeKind === 'file'} onClick={() => onOpen('file')} title="View & edit files">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-panel-2 text-ink-soft">
            <Files size={16} />
          </span>
          <Label title="Files" count={files.length} />
        </GroupTile>
      )}
    </div>
  )
}

function GroupTile({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 rounded-xl border bg-surface py-1 pl-1 pr-2.5 transition ${
        active ? 'border-accent ring-1 ring-accent/30' : 'border-line-strong hover:border-accent'
      }`}
    >
      {children}
    </button>
  )
}

function Label({ title, count }: { title: string; count: number }) {
  return (
    <span className="text-left leading-tight">
      <span className="block text-[12px] font-medium text-ink">{title}</span>
      <span className="block text-[11px] text-ink-faint">
        {count} item{count > 1 ? 's' : ''}
      </span>
    </span>
  )
}
