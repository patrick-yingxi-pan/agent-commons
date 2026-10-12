import {
  MAX_AUTHORED_CELL_CHARS,
  MAX_AUTHORED_DOCUMENT_SOURCE_CHARS,
  MAX_AUTHORED_LABEL_CHARS,
  MAX_AUTHORED_SHEET_COLUMNS,
  MAX_AUTHORED_SHEET_ROWS,
  MAX_AUTHORED_SLIDES,
  MAX_AUTHORED_SLIDE_BULLETS,
  MAX_AUTHORED_STRUCTURE_CHARS,
  MAX_AUTHORED_WORKBOOK_CELLS,
  MAX_AUTHORED_WORKBOOK_SHEETS,
  MAX_WORKBOOK_SHEET_ID_CHARS,
  MAX_WORKBOOK_SHEET_NAME_CHARS,
  authoredArtifact,
  type ScheduledArtifactSpec,
  type StructuredArtifactBody,
} from '../contract/index.ts'

export const ROUTINE_ARTIFACT_TOOL_NAME = 'submit_routine_artifact'

export type RoutineArtifactFailure = 'invalid_candidate' | 'duplicate_candidate'

/** The routine worker owns this port. Model execution may submit through it,
 * but callers can only observe detached result/failure snapshots after the
 * complete turn has settled. */
export interface RoutineArtifactCapture {
  readonly spec: ScheduledArtifactSpec
  readonly result: StructuredArtifactBody | undefined
  readonly failure: RoutineArtifactFailure | undefined
}

export interface ArtifactBodySchema {
  type?: string
  description?: string
  items?: ArtifactBodySchema
  oneOf?: ArtifactBodySchema[]
  properties?: Record<string, ArtifactBodySchema>
  required?: string[]
  additionalProperties?: boolean
  enum?: string[]
  minItems?: number
  maxItems?: number
  maxLength?: number
  minLength?: number
  pattern?: string
}

function sheetCellSchema(): ArtifactBodySchema {
  return {
    oneOf: [
      { type: 'string', description: `A literal cell value (≤${MAX_AUTHORED_CELL_CHARS} characters).`, maxLength: MAX_AUTHORED_CELL_CHARS },
      {
        type: 'object',
        description: "A formula cell. Formula source is saved exactly; supported expressions are optional leading =, unary/binary + - * /, parentheses, same-sheet data-row A1 references, named-sheet references such as Sheet!A1 or 'Sheet name'!A1 (doubled apostrophes escape apostrophes), and SUM of values, arguments, or ranges. Sheet names match case-insensitively within this workbook. Headers and external sheets are not addressable. An empty source is retained and evaluates to #FORMULA!.",
        properties: { formula: { type: 'string', maxLength: MAX_AUTHORED_CELL_CHARS } },
        required: ['formula'], additionalProperties: false,
      },
    ],
  }
}

function sheetBodySchema(): ArtifactBodySchema {
  const cellSchema = sheetCellSchema()
  return {
    type: 'object',
    description: `A bounded, rectangular sheet body: ${MAX_AUTHORED_SHEET_COLUMNS} columns, ${MAX_AUTHORED_SHEET_ROWS} rows, and ${MAX_AUTHORED_STRUCTURE_CHARS} UTF-16 characters total. Cell strings are literal; formula cells use the explicit {formula: string} tag.`,
    properties: {
      type: { type: 'string', enum: ['sheet'], description: 'Must be sheet.' },
      columns: { type: 'array', minItems: 1, maxItems: MAX_AUTHORED_SHEET_COLUMNS, description: `Nonblank column labels (≤${MAX_AUTHORED_LABEL_CHARS} characters each).`, items: { type: 'string', description: 'A nonblank column label.', maxLength: MAX_AUTHORED_LABEL_CHARS } },
      rows: { type: 'array', minItems: 1, maxItems: MAX_AUTHORED_SHEET_ROWS, description: 'Rows; each row must have exactly the same number of cells as columns.', items: { type: 'array', minItems: 1, maxItems: MAX_AUTHORED_SHEET_COLUMNS, description: 'A rectangular row of literal or explicitly tagged formula cells.', items: cellSchema } },
      note: { type: 'string', description: `Optional literal note (≤${MAX_AUTHORED_CELL_CHARS} characters).`, maxLength: MAX_AUTHORED_CELL_CHARS },
    },
    required: ['type', 'columns', 'rows'],
    additionalProperties: false,
  }
}

function workbookBodySchema(): ArtifactBodySchema {
  const cellSchema = sheetCellSchema()
  return {
    type: 'object',
    description: `One workbook artifact with 1–${MAX_AUTHORED_WORKBOOK_SHEETS} ordered worksheets, at most ${MAX_AUTHORED_WORKBOOK_CELLS} data cells total, and ${MAX_AUTHORED_STRUCTURE_CHARS} UTF-16 characters total across grid labels, cell strings or formula sources, and notes. Tab IDs are stable within this workbook; names are unique ignoring case. Strings remain literal; only {formula: string} cells are calculated.`,
    properties: {
      type: { type: 'string', enum: ['workbook'], description: 'Must be workbook.' },
      sheets: {
        type: 'array', minItems: 1, maxItems: MAX_AUTHORED_WORKBOOK_SHEETS,
        description: 'Ordered worksheets inside the one workbook artifact.',
        items: {
          type: 'object', description: 'One named worksheet with a bounded rectangular grid.',
          properties: {
            id: { type: 'string', minLength: 1, maxLength: MAX_WORKBOOK_SHEET_ID_CHARS, pattern: '^[A-Za-z0-9_-]+$', description: 'Stable tab identifier, local to this workbook.' },
            name: { type: 'string', minLength: 1, maxLength: MAX_WORKBOOK_SHEET_NAME_CHARS, description: 'Trimmed, nonblank Excel worksheet name; names must be unique ignoring case.' },
            columns: { type: 'array', minItems: 1, maxItems: MAX_AUTHORED_SHEET_COLUMNS, description: 'Nonblank column labels.', items: { type: 'string', maxLength: MAX_AUTHORED_LABEL_CHARS } },
            rows: { type: 'array', minItems: 1, maxItems: MAX_AUTHORED_SHEET_ROWS, description: 'Rectangular literal or explicitly tagged formula cell rows.', items: { type: 'array', minItems: 1, maxItems: MAX_AUTHORED_SHEET_COLUMNS, items: cellSchema } },
            note: { type: 'string', maxLength: MAX_AUTHORED_CELL_CHARS, description: 'Optional literal worksheet note.' },
          },
          required: ['id', 'name', 'columns', 'rows'],
          additionalProperties: false,
        },
      },
    },
    required: ['type', 'sheets'],
    additionalProperties: false,
  }
}

function spreadsheetBodySchema(): ArtifactBodySchema {
  return { description: 'One legacy single-sheet body or one named multi-worksheet workbook body.', oneOf: [sheetBodySchema(), workbookBodySchema()] }
}

function slideBodySchema(): ArtifactBodySchema {
  return {
    type: 'object',
    description: `A bounded slide deck: ${MAX_AUTHORED_SLIDES} slides, ${MAX_AUTHORED_SLIDE_BULLETS} bullets per slide, and ${MAX_AUTHORED_STRUCTURE_CHARS} UTF-16 characters total. Text is literal; no layout or presentation-file generation is implied.`,
    properties: {
      type: { type: 'string', enum: ['slides'], description: 'Must be slides.' },
      slides: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_AUTHORED_SLIDES,
        description: 'Slides in presentation order.',
        items: {
          type: 'object',
          description: 'One slide.',
          properties: {
            title: { type: 'string', description: `A nonblank slide title (≤${MAX_AUTHORED_LABEL_CHARS} characters).`, maxLength: MAX_AUTHORED_LABEL_CHARS },
            bullets: { type: 'array', minItems: 0, maxItems: MAX_AUTHORED_SLIDE_BULLETS, description: 'Literal slide bullets.', items: { type: 'string', description: `A literal bullet (≤${MAX_AUTHORED_CELL_CHARS} characters).`, maxLength: MAX_AUTHORED_CELL_CHARS } },
          },
          required: ['title', 'bullets'],
          additionalProperties: false,
        },
      },
    },
    required: ['type', 'slides'],
    additionalProperties: false,
  }
}

/** A fresh schema tree per declaration: neither the SDK nor a test can mutate a
 * shared definition and thereby weaken a later turn. */
export function authoredArtifactBodySchema(): ArtifactBodySchema {
  return {
    description: `The complete document text, a sheet or workbook, or slides. Documents are limited to ${MAX_AUTHORED_DOCUMENT_SOURCE_CHARS} characters; spreadsheet formula cells use the explicit formula tag and supported expressions are calculated.`,
    oneOf: [
      { type: 'string', description: 'Document text.', maxLength: MAX_AUTHORED_DOCUMENT_SOURCE_CHARS },
      spreadsheetBodySchema(),
      slideBodySchema(),
    ],
  }
}

function structuredBodySchema(kind: 'sheet' | 'slide'): ArtifactBodySchema {
  return kind === 'sheet' ? spreadsheetBodySchema() : slideBodySchema()
}

export function routineArtifactToolDefinition(capture: RoutineArtifactCapture) {
  const { spec } = capture
  if (spec.kind === 'doc') throw new Error('Document routines use the prose result, not the structured artifact tool.')
  return {
    name: ROUTINE_ARTIFACT_TOOL_NAME,
    description: `Submit the complete ${spec.kind === 'sheet' ? 'sheet or workbook' : 'slide deck'} body for the routine output '${spec.name}'. Submit exactly once; the server already owns its name and kind.`,
    input_schema: {
      type: 'object' as const,
      properties: { body: structuredBodySchema(spec.kind) },
      required: ['body'],
      additionalProperties: false,
    },
  }
}

type CaptureState = {
  attempts: number
  result?: StructuredArtifactBody
  failure?: RoutineArtifactFailure
}

const states = new WeakMap<RoutineArtifactCapture, CaptureState>()

class Capture implements RoutineArtifactCapture {
  readonly #spec: ScheduledArtifactSpec
  constructor(spec: ScheduledArtifactSpec) {
    if (spec.kind === 'doc') throw new Error('A structured routine artifact capture requires sheet or slide.')
    this.#spec = Object.freeze({ name: spec.name, kind: spec.kind })
    states.set(this, { attempts: 0 })
  }
  get spec(): ScheduledArtifactSpec { return { ...this.#spec } }
  get result(): StructuredArtifactBody | undefined {
    const value = states.get(this)?.result
    return value === undefined ? undefined : structuredClone(value)
  }
  get failure(): RoutineArtifactFailure | undefined { return states.get(this)?.failure }
}

export function createRoutineArtifactCapture(spec: ScheduledArtifactSpec): RoutineArtifactCapture {
  return new Capture(spec)
}

export interface StagedRoutineArtifact {
  readonly status: 'candidate' | 'invalid' | 'duplicate'
  readonly body?: StructuredArtifactBody
}

function strictBodyInput(value: unknown): value is { body: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) &&
    Object.hasOwn(value, 'body') && Object.keys(value).length === 1
}

/** Pure staging half. The shared executor commits this value only after its
 * deadline/cancellation race reports a successful settlement. */
export function stageRoutineArtifact(capture: RoutineArtifactCapture, input: unknown): StagedRoutineArtifact {
  const state = states.get(capture)
  if (!state) return { status: 'invalid' }
  if (state.attempts > 0) return { status: 'duplicate' }
  const { spec } = capture
  if (!strictBodyInput(input)) return { status: 'invalid' }
  const authored = authoredArtifact(spec.name, spec.kind, input.body)
  if (!authored || typeof authored.draftBody === 'string') return { status: 'invalid' }
  return { status: 'candidate', body: structuredClone(authored.draftBody) }
}

/** Settlement half. Once poisoned, a capture cannot be repaired by a later
 * model call; one malformed or duplicate submission makes the run fail. */
export function commitRoutineArtifact(capture: RoutineArtifactCapture, staged: StagedRoutineArtifact): void {
  const state = states.get(capture)
  if (!state) return
  state.attempts += 1
  if (state.attempts > 1 || staged.status === 'duplicate') {
    state.result = undefined
    state.failure = 'duplicate_candidate'
    return
  }
  if (staged.status !== 'candidate' || !staged.body) {
    state.failure = 'invalid_candidate'
    return
  }
  state.result = structuredClone(staged.body)
}

/** A declared repeated submission can be refused before invocation by the
 * shared call/deadline guard. It still poisons an already accepted candidate:
 * otherwise lowering the batch limit would silently turn two submissions into
 * the required exactly-one result. A refused first attempt publishes nothing. */
export function poisonRepeatedRoutineArtifact(capture: RoutineArtifactCapture): void {
  const state = states.get(capture)
  if (!state || state.attempts === 0) return
  state.attempts += 1
  state.result = undefined
  state.failure = 'duplicate_candidate'
}
