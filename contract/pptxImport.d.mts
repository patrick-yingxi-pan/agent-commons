export const MAX_PPTX_FILE_BYTES: number
export const MAX_PPTX_SELECTION_BYTES: number
export const MAX_PPTX_TEXT_BYTES: number
export const MAX_PPTX_ENTRIES: number
export const MAX_PPTX_PART_BYTES: number
export const MAX_PPTX_EXPANDED_BYTES: number
export const MAX_PPTX_SLIDES: number
export const PPTX_IMPORT_TIMEOUT_MS: number
export type PptxImportStatus = 'ready' | 'no-text' | 'file-too-large' | 'selection-limit' | 'text-limit' | 'structure-limit' | 'unsupported' | 'timeout' | 'invalid' | 'unavailable'
export interface PptxImportOutcome { format: 'pptx'; status: PptxImportStatus }
export interface PptxImportResult { text?: string; documentImport: PptxImportOutcome }
export function isPptxFileName(name: unknown): boolean
export function pptxImportFailure(status: Exclude<PptxImportStatus, 'ready' | 'no-text'>): PptxImportResult
export function isPptxImportOutcome(value: unknown): value is PptxImportOutcome
export function pptxImportCopy(outcome?: PptxImportOutcome): string
