import type { ArtifactHistoryBody } from '../../contract/artifactHistory.ts'
import type { DocBlock, SheetGrid, WorkbookSheet } from '../../contract/content.ts'
import { isFormulaCell, sheetCellSource, type SheetCell } from '../../contract/sheetCell.ts'

export const ARTIFACT_HISTORY_COMPARE_PAGE_SIZE = 20

export interface ArtifactHistoryChange {
  key: string
  label: string
  before: string | undefined
  after: string | undefined
}

type BlockKind = 'Heading' | 'Paragraph' | 'Bullet list' | 'Code block' | 'Email'

function blockKind(block: DocBlock): BlockKind {
  if ('h' in block) return 'Heading'
  if ('p' in block) return 'Paragraph'
  if ('ul' in block) return 'Bullet list'
  if ('code' in block) return 'Code block'
  return 'Email'
}

function columnName(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    value -= 1
    name = String.fromCharCode(65 + value % 26) + name
    value = Math.floor(value / 26)
  }
  return name
}

function quoted(value: string): string {
  return `“${value}”`
}

/** Compare authored history bodies literally. Positions are structural identity
 * for blocks, slides, rows and columns; workbook tabs alone use their stored ID. */
export function compareArtifactHistoryBodies(
  before: ArtifactHistoryBody,
  after: ArtifactHistoryBody,
): ArtifactHistoryChange[] {
  const changes: ArtifactHistoryChange[] = []

  const add = (path: Array<string | number>, label: string, oldValue: string | undefined, newValue: string | undefined) => {
    if (oldValue === newValue) return
    changes.push({ key: JSON.stringify(['artifact-history', ...path]), label, before: oldValue, after: newValue })
  }
  const count = (path: Array<string | number>, label: string, oldLength: number, newLength: number) => {
    add(path, label, String(oldLength), String(newLength))
  }
  const stringArray = (
    path: Array<string | number>,
    countLabel: string,
    label: (index: number) => string,
    oldValues: string[],
    newValues: string[],
  ) => {
    count([...path, 'length'], countLabel, oldValues.length, newValues.length)
    const length = Math.max(oldValues.length, newValues.length)
    for (let index = 0; index < length; index += 1) {
      add([...path, 'item', index], label(index), oldValues[index], newValues[index])
    }
  }
  const grid = (oldGrid: SheetGrid | undefined, newGrid: SheetGrid | undefined, label: string, path: Array<string | number>) => {
    const oldColumns = oldGrid?.columns ?? []
    const newColumns = newGrid?.columns ?? []
    stringArray([...path, 'columns'], `${label} · Header count`, (index) => `${label} · Header ${columnName(index)}`, oldColumns, newColumns)
    const oldRows = oldGrid?.rows ?? []
    const newRows = newGrid?.rows ?? []
    count([...path, 'rows', 'length'], `${label} · Row count`, oldRows.length, newRows.length)
    const rowCount = Math.max(oldRows.length, newRows.length)
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const oldRow = oldRows[rowIndex]
      const newRow = newRows[rowIndex]
      const oldCells = oldRow ?? []
      const newCells = newRow ?? []
      const rowLabel = `${label} · Row ${rowIndex + 1}`
      count([...path, 'row', rowIndex, 'length'], `${rowLabel} · Cell count`, oldCells.length, newCells.length)
      const cellCount = Math.max(oldCells.length, newCells.length)
      for (let columnIndex = 0; columnIndex < cellCount; columnIndex += 1) {
        const address = `${columnName(columnIndex)}${rowIndex + 1}`
        const oldCell = oldCells[columnIndex]
        const newCell = newCells[columnIndex]
        const oldFormula = oldCell !== undefined && isFormulaCell(oldCell)
        const newFormula = newCell !== undefined && isFormulaCell(newCell)
        if (oldFormula || newFormula) {
          add([...path, 'cell', rowIndex, columnIndex, 'kind'], `${label} · Cell ${address} · Kind`,
            oldCell === undefined ? undefined : oldFormula ? 'Formula' : 'Literal',
            newCell === undefined ? undefined : newFormula ? 'Formula' : 'Literal')
        }
        const source = (cell: SheetCell | undefined) => cell === undefined
          ? undefined : sheetCellSource(cell)
        add([...path, 'cell', rowIndex, columnIndex], `${label} · Cell ${address}`, source(oldCell), source(newCell))
      }
    }
    add([...path, 'note'], `${label} · Note`, oldGrid?.note, newGrid?.note)
  }
  const workbookSheet = (
    oldSheet: WorkbookSheet | undefined,
    newSheet: WorkbookSheet | undefined,
    id: string,
    oldPosition: number | undefined,
    newPosition: number | undefined,
    namespace: string,
  ) => {
    const displayName = newSheet?.name ?? oldSheet?.name ?? id
    const label = `Sheet ${quoted(displayName)}`
    const oldLabel = `Sheet ${quoted(oldSheet?.name ?? displayName)}`
    const path = [namespace, 'sheet', id]
    add([...path, 'presence'], `${label} · Tab`, oldSheet ? 'present' : undefined, newSheet ? 'present' : undefined)
    add([...path, 'position'], `${oldLabel} · Position`, oldPosition === undefined ? undefined : String(oldPosition + 1), newPosition === undefined ? undefined : String(newPosition + 1))
    add([...path, 'name'], `${label} · Name`, oldSheet?.name, newSheet?.name)
    grid(oldSheet, newSheet, label, path)
  }

  if (before.type !== after.type) {
    add(['format'], 'Format', before.type, after.type)
    if (before.type === 'doc') {
      compareDoc(before, undefined, 'removed-doc')
    } else if (before.type === 'sheet') {
      grid(before, undefined, 'Sheet', ['removed-legacy-sheet'])
    } else if (before.type === 'workbook') {
      compareWorkbook(before.sheets, [], 'removed-workbook')
    } else {
      compareSlides(before.slides, [], 'removed-slides')
    }
    if (after.type === 'doc') {
      compareDoc(undefined, after, 'added-doc')
    } else if (after.type === 'sheet') {
      grid(undefined, after, 'Sheet', ['added-legacy-sheet'])
    } else if (after.type === 'workbook') {
      compareWorkbook([], after.sheets, 'added-workbook')
    } else {
      compareSlides([], after.slides, 'added-slides')
    }
    return changes
  }

  if (before.type === 'doc' && after.type === 'doc') {
    compareDoc(before, after)
  } else if (before.type === 'sheet' && after.type === 'sheet') {
    grid(before, after, 'Sheet', ['legacy-sheet'])
  } else if (before.type === 'workbook' && after.type === 'workbook') {
    compareWorkbook(before.sheets, after.sheets)
  } else if (before.type === 'slides' && after.type === 'slides') {
    compareSlides(before.slides, after.slides)
  }
  return changes

  function compareDoc(oldBody: Extract<ArtifactHistoryBody, { type: 'doc' }> | undefined, newBody: Extract<ArtifactHistoryBody, { type: 'doc' }> | undefined, namespace = 'doc') {
    add([namespace, 'title'], 'Document · Title', oldBody?.title, newBody?.title)
    const oldBlocks = oldBody?.blocks ?? []
    const newBlocks = newBody?.blocks ?? []
    count([namespace, 'blocks', 'length'], 'Document · Block count', oldBlocks.length, newBlocks.length)
    for (let index = 0; index < Math.max(oldBlocks.length, newBlocks.length); index += 1) {
      const oldBlock = oldBlocks[index]
      const newBlock = newBlocks[index]
      add([namespace, 'block', index, 'kind'], `Block ${index + 1} · Type`, oldBlock && blockKind(oldBlock), newBlock && blockKind(newBlock))
      if (oldBlock && 'h' in oldBlock || newBlock && 'h' in newBlock) {
        add([namespace, 'block', index, 'h'], `Block ${index + 1} · Heading`, oldBlock && 'h' in oldBlock ? oldBlock.h : undefined, newBlock && 'h' in newBlock ? newBlock.h : undefined)
      }
      if (oldBlock && 'p' in oldBlock || newBlock && 'p' in newBlock) {
        add([namespace, 'block', index, 'p'], `Block ${index + 1} · Paragraph`, oldBlock && 'p' in oldBlock ? oldBlock.p : undefined, newBlock && 'p' in newBlock ? newBlock.p : undefined)
      }
      if (oldBlock && 'ul' in oldBlock || newBlock && 'ul' in newBlock) {
        const oldItems = oldBlock && 'ul' in oldBlock ? oldBlock.ul : []
        const newItems = newBlock && 'ul' in newBlock ? newBlock.ul : []
        stringArray([namespace, 'block', index, 'ul'], `Block ${index + 1} · Bullet item count`, (itemIndex) => `Block ${index + 1} · Bullet item ${itemIndex + 1}`, oldItems, newItems)
      }
      if (oldBlock && 'code' in oldBlock || newBlock && 'code' in newBlock) {
        const oldItems = oldBlock && 'code' in oldBlock ? oldBlock.code : []
        const newItems = newBlock && 'code' in newBlock ? newBlock.code : []
        stringArray([namespace, 'block', index, 'code'], `Block ${index + 1} · Code line count`, (itemIndex) => `Block ${index + 1} · Code line ${itemIndex + 1}`, oldItems, newItems)
      }
      if (oldBlock && 'email' in oldBlock || newBlock && 'email' in newBlock) {
        add([namespace, 'block', index, 'email', 'to'], `Block ${index + 1} · Email · To`, oldBlock && 'email' in oldBlock ? oldBlock.email.to : undefined, newBlock && 'email' in newBlock ? newBlock.email.to : undefined)
        add([namespace, 'block', index, 'email', 'subject'], `Block ${index + 1} · Email · Subject`, oldBlock && 'email' in oldBlock ? oldBlock.email.subject : undefined, newBlock && 'email' in newBlock ? newBlock.email.subject : undefined)
      }
    }
  }

  function compareWorkbook(oldSheets: WorkbookSheet[], newSheets: WorkbookSheet[], namespace = 'workbook') {
    count([namespace, 'sheets', 'length'], 'Workbook · Sheet count', oldSheets.length, newSheets.length)
    const oldPositions = new Map<string, number>()
    const newPositions = new Map<string, number>()
    const oldById = new Map<string, WorkbookSheet>()
    const newById = new Map<string, WorkbookSheet>()
    oldSheets.forEach((sheet, index) => { oldPositions.set(sheet.id, index); oldById.set(sheet.id, sheet) })
    newSheets.forEach((sheet, index) => { newPositions.set(sheet.id, index); newById.set(sheet.id, sheet) })
    const ids = new Set([...oldById.keys(), ...newById.keys()])
    for (const id of ids) workbookSheet(oldById.get(id), newById.get(id), id, oldPositions.get(id), newPositions.get(id), namespace)
  }

  function compareSlides(oldSlides: Array<{ title: string; bullets: string[] }>, newSlides: Array<{ title: string; bullets: string[] }>, namespace = 'slides') {
    count([namespace, 'length'], 'Slides · Slide count', oldSlides.length, newSlides.length)
    for (let index = 0; index < Math.max(oldSlides.length, newSlides.length); index += 1) {
      const oldSlide = oldSlides[index]
      const newSlide = newSlides[index]
      const label = `Slide ${index + 1}`
      add([namespace, 'slide', index, 'title'], `${label} · Title`, oldSlide?.title, newSlide?.title)
      stringArray([namespace, 'slide', index, 'bullets'], `${label} · Bullet count`, (bulletIndex) => `${label} · Bullet ${bulletIndex + 1}`, oldSlide?.bullets ?? [], newSlide?.bullets ?? [])
    }
  }
}
