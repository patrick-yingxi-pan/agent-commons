import { useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Plus, Save, X } from 'lucide-react'
import {
  MAX_AUTHORED_CELL_CHARS,
  MAX_AUTHORED_LABEL_CHARS,
  MAX_AUTHORED_SHEET_COLUMNS,
  MAX_AUTHORED_SHEET_ROWS,
  MAX_AUTHORED_SLIDE_BULLETS,
  MAX_AUTHORED_SLIDES,
  MAX_AUTHORED_WORKBOOK_SHEETS,
  MAX_WORKBOOK_SHEET_NAME_CHARS,
  spreadsheetSheets,
  parseEditableArtifactBody,
  type EditableArtifactBody,
  type SheetGrid,
  type StructuredArtifactBody,
} from '../../contract/index.ts'
import { StructuredArtifactView } from './DeferredStructuredArtifactView'
import { DocumentArtifactEditor, DocumentBodyLiteral } from './DocumentArtifactEditor'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { WorkbookTabs } from './WorkbookTabs'
import { pasteSheetCells, reconcileSheetPasteFeedback, type SheetPasteFeedback, type SpreadsheetBody } from '../lib/sheetPaste'

type Props = {
  body: EditableArtifactBody
  onChange: (body: EditableArtifactBody) => void
  latestBody?: EditableArtifactBody
  onSave: () => void
  onCancel: () => void
  saving?: boolean
  error?: string | null
  /** The latest read is shown beside a held draft after a conflict. */
  showLatest?: boolean
}

const buttonClass = INLINE_ACTION_CLASS

/** Owner-only full-page editor for one complete structured body. Previews keep
 * using StructuredArtifactView; the account-scoped draft store owns lifetime
 * across navigation and duplicate panes. Save emits one complete replacement. */
export function StructuredArtifactEditor({ body, onChange, latestBody, onSave, onCancel, saving = false, error, showLatest = false }: Props) {
  if (body.type === 'doc') {
    return <DocumentArtifactEditor body={body} onChange={onChange} latestBody={latestBody?.type === 'doc' ? latestBody : undefined}
      onSave={onSave} onCancel={onCancel} saving={saving} error={error} showLatest={showLatest} />
  }
  const valid = parseEditableArtifactBody(body) !== undefined

  return (
    <div className="space-y-3" data-structured-artifact-editor={body.type}>
      <StructuredArtifactFields body={body} onChange={onChange} disabled={saving} />
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <button type="button" data-inline-action className={buttonClass} disabled={saving || !valid} onClick={onSave}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" data-inline-action className={buttonClass} disabled={saving} onClick={onCancel}>
          <X size={13} /> Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-danger-text" role="status">{error}</p>}
      {!valid && <p className="text-[11px] text-danger-text" role="alert">Review blank labels, duplicate or invalid worksheet names, or the saved size limits before saving.</p>}
      {showLatest && latestBody && (
        <div className="space-y-1.5 rounded-lg border border-line bg-panel-2/40 p-2.5" role="status">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Latest saved version</div>
          {latestBody.type === 'doc' ? <DocumentBodyLiteral body={latestBody} /> : <StructuredArtifactView body={latestBody} size="compact" />}
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
  return body.type === 'slides'
    ? <SlidesEditor body={body} onChange={onChange} disabled={disabled} />
    : <WorkbookEditor body={body} onChange={onChange} disabled={disabled} />
}

function WorkbookEditor({ body, onChange, disabled }: {
  body: Exclude<StructuredArtifactBody, { type: 'slides' }>
  onChange: (body: StructuredArtifactBody) => void
  disabled: boolean
}) {
  const sheets = spreadsheetSheets(body)
  const [selected, select] = useState(sheets[0]!.id)
  const [removed, setRemoved] = useState<{ sheet: typeof sheets[number]; index: number } | null>(null)
  const [paste, setPaste] = useState<SheetPasteFeedback | null>(null)
  const change = (next: SpreadsheetBody) => { setPaste(null); onChange(next) }
  const active = sheets.find(sheet => sheet.id === selected) ?? sheets[0]!
  const index = sheets.indexOf(active)
  const setSheets = (next: typeof sheets) => change({ type: 'workbook', sheets: next })
  // A duplicate pane may edit the shared draft. Never undo across a later edit.
  const currentPaste = reconcileSheetPasteFeedback(paste, body)
  // Adjust this component's state before children render; equal text restored
  // by a later edit must not resurrect a retired Undo snapshot.
  if (currentPaste !== paste) setPaste(currentPaste)
  const pasteCells = (row: number, column: number, text: string) => {
    if (disabled) return true
    const result = pasteSheetCells(body, active.id, row, column, text)
    if (result.kind === 'native') return false
    if (result.kind === 'error') setPaste({ ...currentPaste, message: result.message, error: true, after: JSON.stringify(body) })
    else {
      setPaste({ message: `Pasted ${result.rows} × ${result.columns} cells into this draft.`, error: false,
        before: body, after: JSON.stringify(result.body) })
      onChange(result.body)
    }
    return true
  }
  const move = (delta: number) => {
    const target = index + delta
    if (target < 0 || target >= sheets.length) return
    const next = [...sheets]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setSheets(next)
  }
  const add = () => {
    let number = sheets.length + 1
    while (sheets.some(sheet => sheet.name.toLowerCase() === `sheet ${number}`)) number++
    const sheet = { id: crypto.randomUUID(), name: `Sheet ${number}`, columns: ['Column 1'], rows: [['']] }
    setSheets([...sheets, sheet])
    select(sheet.id)
  }
  return <div className="min-w-0 space-y-2">
    <WorkbookTabs sheets={sheets} activeId={active.id} onSelect={id => { setPaste(null); select(id) }}>
      <div className="space-y-2">
        <label className="block text-[11px] text-ink-soft">Worksheet name
          <input aria-label="Worksheet name" maxLength={MAX_WORKBOOK_SHEET_NAME_CHARS} className={`${FORM_INPUT_CLASS} mt-1 w-full`} value={active.name} disabled={disabled}
            onChange={event => setSheets(sheets.map(sheet => sheet.id === active.id ? { ...sheet, name: event.target.value } : sheet))} />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || sheets.length >= MAX_AUTHORED_WORKBOOK_SHEETS} onClick={add}><Plus size={12} /> Add worksheet</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || index === 0} onClick={() => move(-1)}><ArrowUp size={12} /> Move worksheet earlier</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || index === sheets.length - 1} onClick={() => move(1)}><ArrowDown size={12} /> Move worksheet later</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || sheets.length <= 1} onClick={() => {
            setRemoved({ sheet: active, index })
            setSheets(sheets.filter(sheet => sheet.id !== active.id))
            select(sheets[index === 0 ? 1 : index - 1]!.id)
          }}><Minus size={12} /> Remove worksheet</button>
        </div>
        <SheetEditor body={active} disabled={disabled} onPasteCells={pasteCells} onChange={({ columns, rows, note }) => {
          const grid = { columns, rows, ...(note === undefined ? {} : { note }) }
          if (body.type === 'sheet') change({ type: 'sheet', ...grid })
          else setSheets(sheets.map(sheet => sheet.id === active.id ? { id: sheet.id, name: sheet.name, ...grid } : sheet))
        }} />
        {currentPaste && <div role="status" data-sheet-paste-feedback className={`flex flex-wrap items-center gap-2 text-[11px] ${currentPaste.error ? 'text-danger-text' : 'text-ink-soft'}`}>
          <span>{currentPaste.message}</span>
          {currentPaste.before && <button type="button" data-inline-action className={buttonClass} disabled={disabled}
            onClick={() => change(currentPaste.before!)}>Undo paste</button>}
        </div>}
      </div>
    </WorkbookTabs>
    {removed && <div role="status" className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">Removed “{removed.sheet.name}” from this draft.</span>
      <button type="button" data-inline-action className={buttonClass} disabled={disabled || sheets.length >= MAX_AUTHORED_WORKBOOK_SHEETS || sheets.some(sheet => sheet.id === removed.sheet.id || sheet.name.toLowerCase() === removed.sheet.name.toLowerCase())} onClick={() => {
        const next = [...sheets]
        next.splice(Math.min(removed.index, next.length), 0, removed.sheet)
        setSheets(next)
        select(removed.sheet.id)
        setRemoved(null)
      }}>Undo removal</button>
    </div>}
    <p className="text-[11px] leading-relaxed text-ink-faint">All worksheets share this artifact’s access and one Save. Up to 20 tabs, 6,400 cells and 20,000 characters total. Names must be unique, 1–31 characters, with no []:*?/\\ or outer spaces/apostrophes. Values are literal; formulas are not calculated.</p>
  </div>
}

function SheetEditor({
  body,
  onChange,
  onPasteCells,
  disabled,
}: {
  body: SheetGrid
  onChange: (body: SheetGrid) => void
  onPasteCells: (row: number, column: number, text: string) => boolean
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
      <p className="text-[11px] leading-relaxed text-ink-faint">Paste a table into its first cell: tabs separate columns, line breaks start rows. The range replaces existing cells and expands this worksheet as needed. Review before saving; values stay literal.</p>
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
              <textarea aria-label={`Sheet row ${rowIndex + 1} value ${columnIndex + 1}`} maxLength={MAX_AUTHORED_CELL_CHARS} className={`${FORM_INPUT_CLASS} min-w-24 resize-y`} rows={2} disabled={disabled} value={row[columnIndex] ?? ''} onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)}
                onPaste={event => { if (onPasteCells(rowIndex, columnIndex, event.clipboardData.getData('text/plain'))) event.preventDefault() }} />
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
