import { useEffect, useState } from 'react'
import { Crop, FileText, Image as ImageIcon, PenLine, RotateCw, Sheet, Trash2 } from 'lucide-react'
import type { Attachment, ArtifactKind } from '../types'
import { gradientFor } from '../lib/thumbs'
import { PanelShell } from './PanelShell'
import { ArtifactBodyView } from './artifactPreview'

/** Right-side panel that displays a group of file or photo attachments and lets
 *  the user preview / edit / remove them. Opened by clicking a file/photo chip;
 *  `initialId` pre-selects the clicked item. */
export function AttachmentPanel({
  kind,
  items,
  initialId,
  onClose,
  onRemove,
}: {
  kind: 'file' | 'photo'
  items: Attachment[]
  initialId?: string
  onClose: () => void
  onRemove: (id: string) => void
}) {
  const [selectedId, setSelectedId] = useState(initialId ?? items[0]?.id)
  // Per-item edit drafts live here (not in the child) so switching between
  // files/photos preserves unsaved edits instead of discarding them on remount.
  const [fileDrafts, setFileDrafts] = useState<Record<string, { text: string; saved: string }>>({})
  const [photoDrafts, setPhotoDrafts] = useState<
    Record<string, { caption: string; applied: string[] }>
  >({})

  useEffect(() => {
    if (!items.some((i) => i.id === selectedId)) setSelectedId(items[0]?.id)
  }, [items, selectedId])

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
            draft={photoDrafts[selected.id]}
            onDraft={(d) => setPhotoDrafts((m) => ({ ...m, [selected.id]: d }))}
            onSelect={setSelectedId}
            onRemove={onRemove}
          />
        ) : (
          <FileBody
            item={selected}
            items={items}
            draft={fileDrafts[selected.id]}
            onDraft={(d) => setFileDrafts((m) => ({ ...m, [selected.id]: d }))}
            onSelect={setSelectedId}
            onRemove={onRemove}
          />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">No items</div>
      )}
    </PanelShell>
  )
}

const PHOTO_TOOLS = [
  { id: 'crop', label: 'Crop', Icon: Crop },
  { id: 'rotate', label: 'Rotate', Icon: RotateCw },
  { id: 'annotate', label: 'Annotate', Icon: PenLine },
]

function PhotoBody({
  item,
  items,
  draft,
  onDraft,
  onSelect,
  onRemove,
}: {
  item: Attachment
  items: Attachment[]
  draft?: { caption: string; applied: string[] }
  onDraft: (d: { caption: string; applied: string[] }) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  const caption = draft?.caption ?? ''
  const applied = draft?.applied ?? []

  const toggle = (id: string) =>
    onDraft({
      caption,
      applied: applied.includes(id) ? applied.filter((x) => x !== id) : [...applied, id],
    })

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="grid grid-cols-3 gap-1.5 p-2.5">
        {items.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            title={p.label}
            className={`aspect-square rounded-lg ring-2 transition ${gradientFor(p.id)} ${
              p.id === item.id ? 'ring-accent' : 'ring-transparent hover:ring-line-strong'
            }`}
          />
        ))}
      </div>

      <div className="border-t border-line p-3">
        <div
          className={`relative flex aspect-video w-full items-end overflow-hidden rounded-lg shadow-inner ${gradientFor(
            item.id,
          )}`}
        >
          <span className="m-2 rounded bg-black/30 px-1.5 py-0.5 text-[11px] font-medium text-white/95">
            {item.label}
          </span>
          {applied.length > 0 && (
            <span className="absolute right-2 top-2 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-accent-strong">
              Edited · {applied.join(', ')}
            </span>
          )}
        </div>

        <div className="mt-2 flex gap-1">
          {PHOTO_TOOLS.map((t) => {
            const on = applied.includes(t.id)
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium transition ${
                  on
                    ? 'border-accent bg-accent-tint text-accent-strong'
                    : 'border-line text-ink-soft hover:bg-surface'
                }`}
              >
                <t.Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </div>

        <input
          value={caption}
          onChange={(e) => onDraft({ caption: e.target.value, applied })}
          placeholder="Add a caption…"
          className="mt-2 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12px] text-ink outline-none transition focus:border-accent"
        />

        <button
          onClick={() => onRemove(item.id)}
          className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-faint transition hover:text-removed"
        >
          <Trash2 size={13} />
          Remove photo
        </button>
      </div>
    </div>
  )
}

function FileBody({
  item,
  items,
  draft,
  onDraft,
  onSelect,
  onRemove,
}: {
  item: Attachment
  items: Attachment[]
  draft?: { text: string; saved: string }
  onDraft: (d: { text: string; saved: string }) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  const info = fileInfo(item.label)
  const saved = draft?.saved ?? info.content
  const text = draft?.text ?? info.content
  const dirty = text !== saved

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
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">{f.label}</span>
              </button>
              <button
                onClick={() => onRemove(f.id)}
                title="Remove file"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-removed group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto border-t border-line bg-surface p-3">
        {info.editable ? (
          <>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Editing · {item.label}
              </span>
              {dirty && <span className="text-[11px] font-semibold text-accent-strong">● Unsaved</span>}
            </div>
            <textarea
              value={text}
              onChange={(e) => onDraft({ text: e.target.value, saved })}
              spellCheck={false}
              className="h-44 w-full flex-1 resize-none rounded-lg border border-line bg-canvas p-2 font-mono text-[12px] leading-relaxed text-ink outline-none transition focus:border-accent"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => onDraft({ text, saved: text })}
                disabled={!dirty}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white transition enabled:hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Preview · {item.label}
            </div>
            <ArtifactBodyView kind={previewKind(info.ext)} name={item.label} size="compact" />
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

/** Which artifact renderer to use for a non-editable file preview. */
function previewKind(ext: string): ArtifactKind {
  if (['png', 'jpg', 'jpeg', 'svg', 'gif'].includes(ext)) return 'image'
  if (['csv', 'xlsx'].includes(ext)) return 'sheet'
  return 'doc'
}

/** Real, hand-authored bodies for the editable files in the attach catalog, so
 *  opening one shows actual content (and edits track as unsaved) rather than a
 *  generic placeholder. */
const FILE_TEXT: Record<string, string> = {
  'metrics.csv':
    'metric,this week,last week,Δ\nWAU,18420,17310,+6.4%\nActivation,71%,67%,+4pt\np95 latency,240ms,1.81s,−87%\nNRR,114%,112%,+2pt',
  'notes.md':
    '# Notes\n\n- Insights ships behind the `insights` flag next week\n- Variant B won the onboarding test (+6.2% activation)\n- Ingest is over error budget — freeze risky changes',
  'changelog.md':
    '# Changelog\n\n## Unreleased\n- Insights dashboard (behind a flag)\n- Unified auth refresh path\n\n## 2026.6.1\n- Rate limiting: 429 + Retry-After\n- Faster widget queries (composite index)',
}

function fileInfo(label: string): { ext: string; editable: boolean; content: string } {
  const ext = label.split('.').pop()?.toLowerCase() ?? ''
  const named = FILE_TEXT[label]
  if (named !== undefined) return { ext, editable: true, content: named }
  if (ext === 'csv')
    return {
      ext,
      editable: true,
      content: 'cohort,users,churn\nAnnual · May,1204,2.1%\nAnnual · Jun,1190,4.8%\nMonthly · Jun,3902,3.0%',
    }
  if (ext === 'md')
    return {
      ext,
      editable: true,
      content: `# ${label.replace(/\.md$/, '')}\n\n- First point\n- Second point\n- Third point\n`,
    }
  if (ext === 'txt')
    return { ext, editable: true, content: 'Plain-text notes.\nEdit me — the change tracks as unsaved.\n' }
  return { ext, editable: false, content: '' }
}
