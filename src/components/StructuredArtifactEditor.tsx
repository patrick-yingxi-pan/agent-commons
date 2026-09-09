import { ArrowDown, ArrowUp, Minus, Plus, Save, X } from 'lucide-react'
import { useState } from 'react'
import {
  MAX_AUTHORED_CELL_CHARS,
  MAX_AUTHORED_LABEL_CHARS,
  MAX_AUTHORED_SHEET_COLUMNS,
  MAX_AUTHORED_SHEET_ROWS,
  MAX_AUTHORED_SLIDE_BULLETS,
  MAX_AUTHORED_SLIDES,
  parseStructuredArtifactBody,
  type StructuredArtifactBody,
} from '../../contract/index.ts'
import { StructuredArtifactView } from './StructuredArtifactView'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'

type Props = {
  body: StructuredArtifactBody
  latestBody?: StructuredArtifactBody
  onSave: (body: StructuredArtifactBody) => void | Promise<void>
  onCancel: () => void
  saving?: boolean
  /** The latest read is shown beside a held draft after a conflict. */
  showLatest?: boolean
}

const buttonClass = INLINE_ACTION_CLASS

/** Owner-only full-page editor for one complete structured body. Previews keep
 * using StructuredArtifactView; this component owns a local draft and emits
 * exactly one replacement on Save. */
export function StructuredArtifactEditor({ body, latestBody, onSave, onCancel, saving = false, showLatest = false }: Props) {
  const [draft, setDraft] = useState<StructuredArtifactBody>(() => {
    const snapshot = structuredClone(body) as StructuredArtifactBody & { revision?: number }
    delete snapshot.revision
    return snapshot
  })
  const valid = parseStructuredArtifactBody(draft) !== undefined
  const update = (next: StructuredArtifactBody) => setDraft(next)

  return (
    <div className="space-y-3" data-structured-artifact-editor={draft.type}>
      <StructuredArtifactFields body={draft} onChange={update} disabled={saving} />
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <button type="button" data-inline-action className={buttonClass} disabled={saving || !valid} onClick={() => void onSave(draft)}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" data-inline-action className={buttonClass} disabled={saving} onClick={onCancel}>
          <X size={13} /> Cancel
        </button>
      </div>
      {!valid && <p className="text-[11px] text-removed" role="alert">Review blank labels or the saved size limits before saving.</p>}
      {showLatest && latestBody && (
        <div className="space-y-1.5 rounded-lg border border-line bg-panel-2/40 p-2.5" role="status">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Latest saved version</div>
          <StructuredArtifactView body={latestBody} size="compact" />
          <p className="text-[11px] text-ink-faint">Retry replaces the entire saved structure with your held draft.</p>
        </div>
      )}
    </div>
  )
}

/** Controlled fields shared by creation and correction. The enclosing workflow
 * owns draft lifetime and its single submit/cancel pair. */
export function StructuredArtifactFields({ body, onChange, disabled = false }: {
  body: StructuredArtifactBody
  onChange: (body: StructuredArtifactBody) => void
  disabled?: boolean
}) {
  return body.type === 'sheet'
    ? <SheetEditor body={body} onChange={onChange} disabled={disabled} />
    : <SlidesEditor body={body} onChange={onChange} disabled={disabled} />
}

function SheetEditor({
  body,
  onChange,
  disabled,
}: {
  body: Extract<StructuredArtifactBody, { type: 'sheet' }>
  onChange: (body: StructuredArtifactBody) => void
  disabled: boolean
}) {
  const setColumn = (index: number, value: string) => onChange({ ...body, columns: body.columns.map((column, i) => i === index ? value : column) })
  const setCell = (row: number, column: number, value: string) => onChange({
    ...body,
    rows: body.rows.map((values, rowIndex) => rowIndex === row ? values.map((cell, columnIndex) => columnIndex === column ? value : cell) : values),
  })
  const addColumn = () => onChange({ ...body, columns: [...body.columns, 'New column'], rows: body.rows.map((row) => [...row, '']) })
  const removeColumn = (index: number) => body.columns.length > 1 && onChange({ ...body, columns: body.columns.filter((_, i) => i !== index), rows: body.rows.map((row) => row.filter((_, i) => i !== index)) })
  const addRow = () => onChange({ ...body, rows: [...body.rows, body.columns.map(() => '')] })
  const removeRow = (index: number) => body.rows.length > 1 && onChange({ ...body, rows: body.rows.filter((_, i) => i !== index) })
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" data-inline-action className={buttonClass} disabled={disabled || body.columns.length >= MAX_AUTHORED_SHEET_COLUMNS} onClick={addColumn}><Plus size={12} /> Add column</button>
        <button type="button" data-inline-action className={buttonClass} disabled={disabled || body.rows.length >= MAX_AUTHORED_SHEET_ROWS} onClick={addRow}><Plus size={12} /> Add row</button>
      </div>
      <div className="@container max-w-full overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Edit sheet">
        <table className="min-w-full border-collapse text-[12px]">
          <thead><tr className="bg-panel-2">
            {body.columns.map((column, index) => <th key={index} className="min-w-24 border-l border-line p-1.5 align-top first:border-l-0">
              <textarea aria-label={`Sheet column ${index + 1}`} maxLength={MAX_AUTHORED_LABEL_CHARS} className={`${FORM_INPUT_CLASS} min-w-24 resize-y`} rows={2} disabled={disabled} value={column} onChange={(event) => setColumn(index, event.target.value)} />
              <button type="button" data-inline-action aria-label={`Remove sheet column ${index + 1}`} className={`${buttonClass} mt-1`} disabled={disabled || body.columns.length <= 1} onClick={() => removeColumn(index)}><Minus size={11} /> Remove column</button>
            </th>)}
            <th className="w-8" />
          </tr></thead>
          <tbody>{body.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-line">
            {body.columns.map((_, columnIndex) => <td key={columnIndex} className="min-w-24 border-l border-line p-1.5 align-top first:border-l-0">
              <textarea aria-label={`Sheet row ${rowIndex + 1} value ${columnIndex + 1}`} maxLength={MAX_AUTHORED_CELL_CHARS} className={`${FORM_INPUT_CLASS} min-w-24 resize-y`} rows={2} disabled={disabled} value={row[columnIndex] ?? ''} onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)} />
            </td>)}
            <td className="p-1 align-top"><button type="button" aria-label={`Remove sheet row ${rowIndex + 1}`} className="text-ink-faint hover:text-ink" disabled={disabled || body.rows.length <= 1} onClick={() => removeRow(rowIndex)}><Minus size={13} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <label className="block text-[11px] text-ink-faint">Note<textarea aria-label="Sheet note" maxLength={MAX_AUTHORED_CELL_CHARS} className={`${FORM_INPUT_CLASS} mt-1 w-full resize-y`} rows={2} disabled={disabled} value={body.note ?? ''} onChange={(event) => onChange({ ...body, note: event.target.value })} /></label>
    </div>
  )
}

function SlidesEditor({
  body,
  onChange,
  disabled,
}: {
  body: Extract<StructuredArtifactBody, { type: 'slides' }>
  onChange: (body: StructuredArtifactBody) => void
  disabled: boolean
}) {
  const updateSlide = (index: number, next: { title: string; bullets: string[] }) => onChange({ ...body, slides: body.slides.map((slide, i) => i === index ? next : slide) })
  const addSlide = () => onChange({ ...body, slides: [...body.slides, { title: 'New slide', bullets: [] }] })
  const removeSlide = (index: number) => body.slides.length > 1 && onChange({ ...body, slides: body.slides.filter((_, i) => i !== index) })
  const moveSlide = (index: number, delta: number) => {
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= body.slides.length) return
    const slides = [...body.slides]
    ;[slides[index], slides[nextIndex]] = [slides[nextIndex]!, slides[index]!]
    onChange({ ...body, slides })
  }
  return (
    <div className="space-y-3">
      <button type="button" data-inline-action className={buttonClass} disabled={disabled || body.slides.length >= MAX_AUTHORED_SLIDES} onClick={addSlide}><Plus size={12} /> Add slide</button>
      {body.slides.map((slide, index) => <article key={index} className="space-y-2 rounded-lg border border-line p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Slide {index + 1}</span>
          <button type="button" aria-label={`Move slide ${index + 1} up`} className="text-ink-faint hover:text-ink" disabled={disabled || index === 0} onClick={() => moveSlide(index, -1)}><ArrowUp size={13} /></button>
          <button type="button" aria-label={`Move slide ${index + 1} down`} className="text-ink-faint hover:text-ink" disabled={disabled || index === body.slides.length - 1} onClick={() => moveSlide(index, 1)}><ArrowDown size={13} /></button>
          <button type="button" aria-label={`Remove slide ${index + 1}`} className="ml-auto text-[11px] text-ink-faint hover:text-ink" disabled={disabled || body.slides.length <= 1} onClick={() => removeSlide(index)}>Remove slide</button>
        </div>
        <textarea aria-label={`Slide ${index + 1} title`} maxLength={MAX_AUTHORED_LABEL_CHARS} className={`${FORM_INPUT_CLASS} w-full resize-y`} rows={2} disabled={disabled} value={slide.title} onChange={(event) => updateSlide(index, { ...slide, title: event.target.value })} />
        <div className="space-y-1.5">
          {slide.bullets.map((bullet, bulletIndex) => <div key={bulletIndex} className="flex items-start gap-1.5">
            <textarea aria-label={`Slide ${index + 1} bullet ${bulletIndex + 1}`} maxLength={MAX_AUTHORED_CELL_CHARS} className={`${FORM_INPUT_CLASS} min-w-0 flex-1 resize-y`} rows={2} disabled={disabled} value={bullet} onChange={(event) => updateSlide(index, { ...slide, bullets: slide.bullets.map((item, i) => i === bulletIndex ? event.target.value : item) })} />
            <button type="button" aria-label={`Remove slide ${index + 1} bullet ${bulletIndex + 1}`} className="mt-2 text-ink-faint hover:text-ink" disabled={disabled} onClick={() => updateSlide(index, { ...slide, bullets: slide.bullets.filter((_, i) => i !== bulletIndex) })}><Minus size={13} /></button>
          </div>)}
          <button type="button" data-inline-action aria-label={`Add bullet to slide ${index + 1}`} className={buttonClass} disabled={disabled || slide.bullets.length >= MAX_AUTHORED_SLIDE_BULLETS} onClick={() => updateSlide(index, { ...slide, bullets: [...slide.bullets, ''] })}><Plus size={12} /> Add bullet</button>
        </div>
      </article>)}
    </div>
  )
}
