import { useEffect, useMemo, useState } from 'react'
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
import { workbookSheetNameError } from '../../contract/workbook.ts'
import { calculateWorkbook, removeWorkbookColumn, removeWorkbookRow, removeWorkbookSheet, renameWorkbookSheet, type CalculatedCell } from '../../contract/workbookCalculation.ts'
import { isFormulaCell, sheetCellAddress, sheetCellSource, sheetColumnLabel, type SheetCell } from '../../contract/sheetCell.ts'
import { StructuredArtifactView } from './DeferredStructuredArtifactView'
import { DocumentArtifactEditor, DocumentBodyLiteral } from './DocumentArtifactEditor'
import { ArtifactDraftHistory, type ArtifactDraftHistoryActions } from './ArtifactDraftHistory'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { WorkbookTabs } from './WorkbookTabs'
import { pasteSheetCells, reconcileSheetPasteFeedback, type SheetPasteFeedback, type SpreadsheetBody } from '../lib/sheetPaste'
import type { WorksheetRenameDraft } from '../controller/artifactEditDraftsCore'

type Props = {
  body: EditableArtifactBody
  onChange: (body: EditableArtifactBody, group?: symbol) => void
  history: ArtifactDraftHistoryActions
  latestBody?: EditableArtifactBody
  onSave: () => void
  onCancel: () => void
  saving?: boolean
  error?: string | null
  worksheetRenameDrafts?: Record<string, WorksheetRenameDraft>
  onWorksheetRenameDraftChange?: (sheetId: string, draft: WorksheetRenameDraft | undefined) => void
  /** The latest read is shown beside a held draft after a conflict. */
  showLatest?: boolean
}

const buttonClass = INLINE_ACTION_CLASS

/** Owner-only full-page editor for one complete structured body. Previews keep
 * using StructuredArtifactView; the account-scoped draft store owns lifetime
 * across navigation and duplicate panes. Save emits one complete replacement. */
export function StructuredArtifactEditor({ body, onChange, history, latestBody, onSave, onCancel, saving = false, error, showLatest = false, worksheetRenameDrafts, onWorksheetRenameDraftChange }: Props) {
  const valid = parseEditableArtifactBody(body) !== undefined
  const pendingRenames = (body.type === 'sheet' || body.type === 'workbook' ? spreadsheetSheets(body) : [])
    .filter(sheet => {
      const draft = worksheetRenameDrafts?.[sheet.id]
      return !!draft && draft.baseName === sheet.name && draft.value !== sheet.name
    })
    .map(sheet => sheet.name)

  return (
    <ArtifactDraftHistory body={body} onChange={onChange} history={history} disabled={saving}>{onChange => body.type === 'doc'
      ? <DocumentArtifactEditor body={body} onChange={onChange} latestBody={latestBody?.type === 'doc' ? latestBody : undefined}
          onSave={onSave} onCancel={onCancel} saving={saving} error={error} showLatest={showLatest} />
      : (
        <div className="space-y-3" data-structured-artifact-editor={body.type}>
          <StructuredArtifactFields body={body} onChange={onChange} disabled={saving} undoManaged worksheetRenameDrafts={worksheetRenameDrafts} onWorksheetRenameDraftChange={onWorksheetRenameDraftChange} />
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
            <button type="button" data-inline-action className={buttonClass} disabled={saving || !valid || pendingRenames.length > 0} onClick={onSave}>
              <Save size={13} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" data-inline-action className={buttonClass} disabled={saving} onClick={onCancel}>
              <X size={13} /> Cancel
            </button>
          </div>
          {error && <p className="text-[11px] text-danger-text" role="status">{error}</p>}
          {pendingRenames.length > 0 && <p role="status" data-pending-sheet-renames className="break-words [overflow-wrap:anywhere] text-[11px] text-ink-soft">Finish or cancel worksheet rename{pendingRenames.length === 1 ? '' : 's'} for {pendingRenames.join(', ')} before saving.</p>}
          {!valid && <p className="text-[11px] text-danger-text" role="alert">Review blank labels and worksheet names. Each cell or formula source must be at most 2,000 characters, and the whole sheet or workbook must be at most 20,000 characters. Structural edits can expand formula references past these limits; shorten the affected source before saving.</p>}
          {showLatest && latestBody && (
            <div className="space-y-1.5 rounded-lg border border-line bg-panel-2/40 p-2.5" role="status">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Latest saved version</div>
              {latestBody.type === 'doc' ? <DocumentBodyLiteral body={latestBody} /> : <StructuredArtifactView body={latestBody} size="compact" />}
              <p className="text-[11px] text-ink-faint">Retry replaces the entire saved structure with your held draft.</p>
            </div>
          )}
        </div>
      )}</ArtifactDraftHistory>
  )
}

/** Controlled fields shared by creation and correction. The enclosing workflow
 * owns draft lifetime and its single submit/cancel pair. */
export function StructuredArtifactFields({ body, onChange, disabled = false, undoManaged = false, onPendingRenameChange, worksheetRenameDrafts, onWorksheetRenameDraftChange }: {
  body: StructuredArtifactBody
  onChange: (body: StructuredArtifactBody) => void
  disabled?: boolean
  undoManaged?: boolean
  onPendingRenameChange?: (sheetNames: string[]) => void
  worksheetRenameDrafts?: Record<string, WorksheetRenameDraft>
  onWorksheetRenameDraftChange?: (sheetId: string, draft: WorksheetRenameDraft | undefined) => void
}) {
  return body.type === 'slides'
    ? <SlidesEditor body={body} onChange={onChange} disabled={disabled} />
    : <WorkbookEditor body={body} onChange={onChange} disabled={disabled} undoManaged={undoManaged} onPendingRenameChange={onPendingRenameChange} worksheetRenameDrafts={worksheetRenameDrafts} onWorksheetRenameDraftChange={onWorksheetRenameDraftChange} />
}

function WorkbookEditor({ body, onChange, disabled, undoManaged, onPendingRenameChange, worksheetRenameDrafts, onWorksheetRenameDraftChange }: {
  body: Exclude<StructuredArtifactBody, { type: 'slides' }>
  onChange: (body: StructuredArtifactBody) => void
  disabled: boolean
  undoManaged: boolean
  onPendingRenameChange?: (sheetNames: string[]) => void
  worksheetRenameDrafts?: Record<string, WorksheetRenameDraft>
  onWorksheetRenameDraftChange?: (sheetId: string, draft: WorksheetRenameDraft | undefined) => void
}) {
  const sheets = spreadsheetSheets(body)
  const [selected, select] = useState(sheets[0]!.id)
  const [removed, setRemoved] = useState<{ before: SpreadsheetBody; after: string; sheetName: string; selectedId: string } | null>(null)
  const [localRenameDrafts, setLocalRenameDrafts] = useState<Record<string, WorksheetRenameDraft>>({})
  const renameDrafts = worksheetRenameDrafts ?? localRenameDrafts
  const [renameErrors, setRenameErrors] = useState<Record<string, string>>({})
  const [structureError, setStructureError] = useState<string | null>(null)
  const [paste, setPaste] = useState<SheetPasteFeedback | null>(null)
  const change = (next: SpreadsheetBody) => { setPaste(null); setStructureError(null); onChange(next) }
  const active = sheets.find(sheet => sheet.id === selected) ?? sheets[0]!
  const index = sheets.indexOf(active)
  const setSheets = (next: typeof sheets) => change({ type: 'workbook', sheets: next })
  const calculatedWorkbook = useMemo(() => calculateWorkbook(sheets), [body])
  const calculations = calculatedWorkbook.find(sheet => sheet.id === active.id)?.rows
  const renameDraft = renameDrafts[active.id]?.baseName === active.name ? renameDrafts[active.id]!.value : active.name
  const pendingRenames = sheets.filter(sheet => {
    const draft = renameDrafts[sheet.id]
    return !!draft && draft.baseName === sheet.name && draft.value !== sheet.name
  })
  const pendingSheetNames = pendingRenames.map(sheet => sheet.name)
  const pendingSheetKey = pendingSheetNames.join('\u0000')
  useEffect(() => {
    onPendingRenameChange?.(pendingSheetNames)
  }, [pendingSheetKey, onPendingRenameChange])
  useEffect(() => () => onPendingRenameChange?.([]), [onPendingRenameChange])
  useEffect(() => {
    const names = new Map(sheets.map(sheet => [sheet.id, sheet.name]))
    for (const [id, draft] of Object.entries(renameDrafts)) {
      if (names.get(id) !== draft.baseName) {
        if (onWorksheetRenameDraftChange) onWorksheetRenameDraftChange(id, undefined)
        else setLocalRenameDrafts(current => {
          if (!current[id]) return current
          const next = { ...current }
          delete next[id]
          return next
        })
      }
    }
  }, [body, renameDrafts, onWorksheetRenameDraftChange])
  const currentRemoved = removed?.after === JSON.stringify(body) ? removed : null
  if (currentRemoved !== removed) setRemoved(currentRemoved)
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
      setPaste({ message: `Pasted ${result.rows} × ${result.columns} cells into this draft.${result.replacedFormulas ? ` Replaced ${result.replacedFormulas} formula${result.replacedFormulas === 1 ? '' : 's'} with literal text.` : ''}`, error: false,
        ...(undoManaged ? {} : { before: body }), after: JSON.stringify(result.body) })
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
  const updateRenameDraft = (value: string) => {
    const draft = value === active.name ? undefined : { baseName: active.name, value }
    if (onWorksheetRenameDraftChange) onWorksheetRenameDraftChange(active.id, draft)
    else setLocalRenameDrafts(current => {
      const next = { ...current, ...(draft ? { [active.id]: draft } : {}) }
      if (!draft) delete next[active.id]
      return next
    })
    setRenameErrors(current => ({ ...current, [active.id]: '' }))
  }
  const cancelRename = () => {
    updateRenameDraft(active.name)
    setRenameErrors(current => ({ ...current, [active.id]: '' }))
  }
  const applyRename = () => {
    if (renameDraft === active.name) return
    const nameError = workbookSheetNameError(sheets, active.id, renameDraft)
    if (nameError) {
      setRenameErrors(current => ({ ...current, [active.id]: nameError }))
      return
    }
    const renamed = renameWorkbookSheet(sheets, active.id, renameDraft)
    if (renamed.find(sheet => sheet.id === active.id)?.name !== renameDraft) {
      setRenameErrors(current => ({ ...current, [active.id]: 'This rename would exceed the workbook’s formula-source or content limit. Shorten the affected formula source, then try again.' }))
      return
    }
    setRenameErrors(current => ({ ...current, [active.id]: '' }))
    updateRenameDraft(active.name)
    setSheets(renamed)
  }
  const removeActiveSheet = () => {
    if (sheets.length <= 1) return
    const next = removeWorkbookSheet(sheets, active.id)
    if (next.length === sheets.length) {
      setStructureError('This removal would exceed the workbook’s formula-source or content limit, so no worksheet was removed. Shorten affected formula sources and try again.')
      return
    }
    if (!undoManaged) setRemoved({ before: body, after: JSON.stringify({ type: 'workbook', sheets: next }), sheetName: active.name, selectedId: active.id })
    setSheets(next)
    select(sheets[index === 0 ? 1 : index - 1]!.id)
    updateRenameDraft(active.name)
  }
  const removeActiveRow = (row: number): boolean => {
    const next = removeWorkbookRow(sheets, active.id, row)
    const grid = next.find(sheet => sheet.id === active.id)
    if (!grid || grid.rows.length === active.rows.length) {
      setStructureError('This removal would exceed the workbook’s formula-source or content limit, so no row was removed. Shorten affected formula sources and try again.')
      return false
    }
    if (body.type === 'sheet') {
      change({ type: 'sheet', columns: grid.columns, rows: grid.rows, ...(grid.note === undefined ? {} : { note: grid.note }) })
    } else setSheets(next)
    return true
  }
  const removeActiveColumn = (column: number): boolean => {
    const next = removeWorkbookColumn(sheets, active.id, column)
    const grid = next.find(sheet => sheet.id === active.id)
    if (!grid || grid.columns.length === active.columns.length) {
      setStructureError('This removal would exceed the workbook’s formula-source or content limit, so no column was removed. Shorten affected formula sources and try again.')
      return false
    }
    if (body.type === 'sheet') {
      change({ type: 'sheet', columns: grid.columns, rows: grid.rows, ...(grid.note === undefined ? {} : { note: grid.note }) })
    } else setSheets(next)
    return true
  }
  return <div className="min-w-0 space-y-2">
    <WorkbookTabs sheets={sheets} activeId={active.id} onSelect={id => { setPaste(null); select(id) }}>
      <div className="space-y-2">
        <label className="block text-[11px] text-ink-soft">Worksheet name
          <input aria-label="Worksheet name" data-artifact-transient-input maxLength={MAX_WORKBOOK_SHEET_NAME_CHARS} className={`${FORM_INPUT_CLASS} mt-1 w-full`} value={renameDraft} disabled={disabled}
            onChange={event => updateRenameDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyRename() } }} />
        </label>
        {renameDraft !== active.name && <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" data-inline-action className={buttonClass} disabled={disabled} onClick={applyRename}>Rename worksheet</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled} onClick={cancelRename}>Cancel rename</button>
        </div>}
        {renameDraft !== active.name && Object.hasOwn(renameErrors, active.id) && renameErrors[active.id] && <p role="alert" data-sheet-rename-error className="text-[11px] text-danger-text">{renameErrors[active.id]}</p>}
        {structureError && <p role="alert" data-sheet-structure-error className="text-[11px] text-danger-text">{structureError}</p>}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || sheets.length >= MAX_AUTHORED_WORKBOOK_SHEETS} onClick={add}><Plus size={12} /> Add worksheet</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || index === 0} onClick={() => move(-1)}><ArrowUp size={12} /> Move worksheet earlier</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || index === sheets.length - 1} onClick={() => move(1)}><ArrowDown size={12} /> Move worksheet later</button>
          <button type="button" data-inline-action className={buttonClass} disabled={disabled || sheets.length <= 1 || renameDraft !== active.name} onClick={removeActiveSheet}><Minus size={12} /> Remove worksheet</button>
        </div>
        <SheetEditor key={active.id} body={active} calculations={calculations} disabled={disabled} onPasteCells={pasteCells} onRemoveRow={removeActiveRow} onRemoveColumn={removeActiveColumn} onChange={({ columns, rows, note }) => {
          const grid = { columns, rows, ...(note === undefined ? {} : { note }) }
          if (body.type === 'sheet') change({ type: 'sheet', ...grid })
          else setSheets(sheets.map(sheet => sheet.id === active.id ? { id: sheet.id, name: sheet.name, ...grid } : sheet))
        }} />
        {currentPaste && <div role="status" data-sheet-paste-feedback className={`flex flex-wrap items-center gap-2 text-[11px] ${currentPaste.error ? 'text-danger-text' : 'text-ink-soft'}`}>
          <span>{currentPaste.message}</span>
          {!undoManaged && currentPaste.before && <button type="button" data-inline-action className={buttonClass} disabled={disabled}
            onClick={() => change(currentPaste.before!)}>Undo paste</button>}
        </div>}
      </div>
    </WorkbookTabs>
    {!undoManaged && currentRemoved && <div role="status" className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">Removed “{currentRemoved.sheetName}” from this draft.</span>
      <button type="button" data-inline-action className={buttonClass} disabled={disabled} onClick={() => {
        change(currentRemoved.before)
        select(currentRemoved.selectedId)
        setRemoved(null)
      }}>Undo removal</button>
    </div>}
    <p className="text-[11px] leading-relaxed text-ink-faint">All worksheets share this artifact’s access and one Save. Up to 20 tabs, 6,400 cells and 20,000 characters total. Names must be unique, 1–31 characters, with no []:*?/\\ or outer spaces/apostrophes. Cells are Text unless you explicitly choose Formula; imported and pasted values stay literal.</p>
  </div>
}

function SheetEditor({
  body,
  calculations,
  onChange,
  onPasteCells,
  onRemoveRow,
  onRemoveColumn,
  disabled,
}: {
  body: SheetGrid
  calculations?: CalculatedCell[][]
  onChange: (body: SheetGrid) => void
  onPasteCells: (row: number, column: number, text: string) => boolean
  onRemoveRow: (row: number) => boolean
  onRemoveColumn: (column: number) => boolean
  disabled: boolean
}) {
  const [selected, setSelected] = useState({ row: 0, column: 0 })
  const [modeError, setModeError] = useState<string | null>(null)
  const row = Math.min(selected.row, body.rows.length - 1)
  const column = Math.min(selected.column, body.columns.length - 1)
  const cell = body.rows[row]?.[column] ?? ''
  const formulaMode = isFormulaCell(cell)
  const source = sheetCellSource(cell)
  const result = calculations?.[row]?.[column]
  const displayResult = result?.text ?? (formulaMode ? '#FORMULA!' : source)
  const updateSelectedCell = (value: SheetCell) => onChange({
    ...body,
    rows: body.rows.map((values, r) => r === row ? values.map((current, c) => c === column ? value : current) : values),
  })
  const updateSelectedSource = (nextSource: string) => {
    setModeError(null)
    setCell(row, column, formulaMode ? { formula: nextSource } : nextSource)
  }
  const setMode = (nextMode: string) => {
    if (nextMode === 'Formula' && !formulaMode) {
      if (!source.startsWith('=') && source.length >= MAX_AUTHORED_CELL_CHARS) {
        setModeError('Formula mode adds “=” to this text, which would exceed the 2,000-character cell limit. Shorten it first, then choose Formula.')
        return
      }
      setModeError(null)
      updateSelectedCell({ formula: source.startsWith('=') ? source : `=${source}` })
    } else if (nextMode === 'Text' && formulaMode) {
      setModeError(null)
      updateSelectedCell(source)
    }
  }
  const setColumn = (index: number, value: string) => onChange({ ...body, columns: body.columns.map((column, i) => i === index ? value : column) })
  const setCell = (row: number, column: number, value: SheetCell) => onChange({
    ...body,
    rows: body.rows.map((values, rowIndex) => rowIndex === row ? values.map((cell, columnIndex) => columnIndex === column ? value : cell) : values),
  })
  const addColumn = () => onChange({ ...body, columns: [...body.columns, 'New column'], rows: body.rows.map((row) => [...row, '']) })
  const addRow = () => onChange({ ...body, rows: [...body.rows, body.columns.map(() => '')] })
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" data-inline-action className={buttonClass} disabled={disabled || body.columns.length >= MAX_AUTHORED_SHEET_COLUMNS} onClick={addColumn}><Plus size={12} /> Add column</button>
        <button type="button" data-inline-action className={buttonClass} disabled={disabled || body.rows.length >= MAX_AUTHORED_SHEET_ROWS} onClick={addRow}><Plus size={12} /> Add row</button>
      </div>
      <div className="grid gap-1.5 rounded-lg border border-line bg-panel-2/40 p-2 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-start" data-sheet-cell-toolbar>
        <span className="pt-1 text-[11px] font-semibold tabular-nums text-ink-soft" data-sheet-cell-coordinate>{sheetCellAddress(row, column)}</span>
        <label className="text-[11px] text-ink-soft">Mode
          <select aria-label="Cell mode" className={`${FORM_INPUT_CLASS} mt-0.5`} disabled={disabled} value={formulaMode ? 'Formula' : 'Text'} onChange={event => setMode(event.target.value)}>
            <option>Text</option><option>Formula</option>
          </select>
        </label>
        <div className="min-w-0">
          <label className="block text-[11px] text-ink-soft">{formulaMode ? 'Formula source' : 'Text value'}
            <textarea aria-label={`${formulaMode ? 'Formula source' : 'Text value'} ${sheetCellAddress(row, column)}`} maxLength={MAX_AUTHORED_CELL_CHARS} className={`${FORM_INPUT_CLASS} mt-0.5 w-full resize-y font-mono`} rows={2} disabled={disabled} value={source} onChange={event => updateSelectedSource(event.target.value)}
              onPaste={event => { if (onPasteCells(row, column, event.clipboardData.getData('text/plain'))) event.preventDefault() }} />
          </label>
          {formulaMode && <p className={`mt-1 text-[11px] ${result?.kind === 'error' ? 'text-danger-text' : 'text-ink-soft'}`} data-sheet-cell-result role="status">
            {result?.kind === 'error' ? `Error ${result.code}: ${result.message}` : `Result: ${displayResult}`}
          </p>}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">A1 means the first data cell under the column headings; headings are not addressed. Formula mode supports numeric literals, A1 references within this workbook (including another worksheet, such as Detail!A1 or 'Detail tab'!A1), + - * /, parentheses, and SUM ranges such as SUM(A1:B3). XLSX downloads contain calculated values and errors, not formulas. Paste a table here with tabs between columns and line breaks between rows. Pasted cells always stay literal, including text starting with =; replaced formulas are counted and can be undone.</p>
      {modeError && <p className="text-[11px] text-danger-text" role="alert" data-sheet-mode-error>{modeError}</p>}
      <div className="@container max-w-full overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Edit sheet">
        <table className="min-w-full border-collapse text-[12px]">
          <caption className="sr-only">Column letters and row numbers address data cells only. A1 is the first data cell beneath the column headings.</caption>
          <thead><tr className="bg-panel-2">
            <th className="w-9" aria-label="Column coordinate" />
            {body.columns.map((_, index) => <th key={`coordinate-${index}`} scope="col" aria-label={`Data column ${sheetColumnLabel(index)}`} className="min-w-24 px-1.5 pt-1 text-left font-mono text-[10px] font-normal text-ink-faint">{sheetColumnLabel(index)}</th>)}
            <th className="w-8" />
          </tr><tr className="bg-panel-2">
            <th className="w-9" aria-label="Row coordinate" />
            {body.columns.map((column, index) => <th key={index} className="min-w-24 border-l border-line p-1.5 align-top first:border-l-0">
              <textarea aria-label={`Sheet column ${index + 1}`} maxLength={MAX_AUTHORED_LABEL_CHARS} className={`${FORM_INPUT_CLASS} min-w-24 resize-y`} rows={2} disabled={disabled} value={column} onChange={(event) => setColumn(index, event.target.value)} />
              <button type="button" data-inline-action aria-label={`Remove sheet column ${index + 1}`} className={`${buttonClass} mt-1`} disabled={disabled || body.columns.length <= 1} onClick={() => {
                if (!onRemoveColumn(index)) return
                setSelected(current => ({ ...current, column: current.column > index ? current.column - 1 : Math.min(current.column, body.columns.length - 2) }))
              }}><Minus size={11} /> Remove column</button>
            </th>)}
            <th className="w-8" />
          </tr></thead>
          <tbody>{body.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-line">
            <th scope="row" className="px-1.5 text-right align-top font-mono text-[10px] font-normal text-ink-faint">{rowIndex + 1}</th>
            {body.columns.map((_, columnIndex) => <td key={columnIndex} className="min-w-24 border-l border-line p-1.5 align-top first:border-l-0">
              <textarea aria-label={`Sheet row ${rowIndex + 1} value ${columnIndex + 1}`} maxLength={MAX_AUTHORED_CELL_CHARS} className={`${FORM_INPUT_CLASS} min-w-24 resize-y`} rows={2} disabled={disabled} value={sheetCellSource(row[columnIndex] ?? '')} onFocus={() => { setSelected({ row: rowIndex, column: columnIndex }); setModeError(null) }} onChange={(event) => { setModeError(null); setCell(rowIndex, columnIndex, isFormulaCell(row[columnIndex]) ? { formula: event.target.value } : event.target.value) }}
                onPaste={event => { if (onPasteCells(rowIndex, columnIndex, event.clipboardData.getData('text/plain'))) event.preventDefault() }} />
              {isFormulaCell(row[columnIndex]) && <div className={`mt-1 text-[10px] ${calculations?.[rowIndex]?.[columnIndex]?.kind === 'error' ? 'text-danger-text' : 'text-ink-faint'}`} data-sheet-cell-preview title={sheetCellSource(row[columnIndex]!)}>{calculations?.[rowIndex]?.[columnIndex]?.text ?? '#FORMULA!'}</div>}
            </td>)}
            <td className="p-1 align-top"><button type="button" aria-label={`Remove sheet row ${rowIndex + 1}`} className="text-ink-faint hover:text-ink" disabled={disabled || body.rows.length <= 1} onClick={() => {
              if (!onRemoveRow(rowIndex)) return
              setSelected(current => ({ ...current, row: current.row > rowIndex ? current.row - 1 : Math.min(current.row, body.rows.length - 2) }))
            }}><Minus size={13} /></button></td>
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
