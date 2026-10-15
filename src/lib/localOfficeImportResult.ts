import { isXlsxImportOutcome, MAX_XLSX_TEXT_BYTES, type XlsxImportOutcome } from '../../contract/xlsxImport.mjs'
import { isPptxImportOutcome, MAX_PPTX_TEXT_BYTES, type PptxImportOutcome } from '../../contract/pptxImport.mjs'
import { parseWorkbookImportResult, type WorkbookImportResult } from '../../contract/workbookImport.ts'
import { parsePresentationImportResult, type PresentationImportResult } from '../../contract/presentationImport.ts'

export type LocalOfficeImportResult =
  | { text?: string; documentImport: XlsxImportOutcome; workbookImport: WorkbookImportResult }
  | { text?: string; documentImport: PptxImportOutcome; presentationImport: PresentationImportResult }

function dataOnly(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return false
  seen.add(value)
  const proto = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (proto !== Array.prototype) return false
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor) || !dataOnly(descriptor.value, seen)) return false
    }
    return true
  }
  if (proto !== Object.prototype && proto !== null) return false
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor) || !dataOnly(descriptor.value, seen)) return false
  }
  return true
}

function closedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && dataOnly(value) &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))
}

function failure(format: 'xlsx' | 'pptx', status: 'invalid'): LocalOfficeImportResult {
  return format === 'xlsx'
    ? { documentImport: { format, status }, workbookImport: { documentImport: { format, status } } }
    : { documentImport: { format, status }, presentationImport: { documentImport: { format, status } } }
}

/** Validates the worker envelope before contract parsers detach its structures.
 * No worker-owned object, accessor, extra field, or byte buffer escapes. */
export function parseLocalOfficeImportResult(value: unknown, format: 'xlsx' | 'pptx'): LocalOfficeImportResult {
  const structureKey = format === 'xlsx' ? 'workbookImport' : 'presentationImport'
  if (!closedRecord(value, ['text', 'documentImport', structureKey]) ||
      !Object.hasOwn(value, 'documentImport') || !Object.hasOwn(value, structureKey) ||
      ('text' in value && !Object.hasOwn(value, 'text'))) return failure(format, 'invalid')
  const maxText = format === 'xlsx' ? MAX_XLSX_TEXT_BYTES : MAX_PPTX_TEXT_BYTES
  const text = Object.hasOwn(value, 'text') ? value.text : undefined
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > maxText || new TextEncoder().encode(text).byteLength > maxText)) return failure(format, 'invalid')
  if (format === 'xlsx') {
    const documentImport = value.documentImport
    if (!isXlsxImportOutcome(documentImport)) return failure(format, 'invalid')
    const textReady = documentImport.status === 'ready'
    if (textReady !== (typeof text === 'string')) return failure(format, 'invalid')
    const workbookImport = parseWorkbookImportResult(value.workbookImport)
    return { ...(textReady ? { text } : {}), documentImport: { format, status: documentImport.status }, workbookImport }
  }
  const documentImport = value.documentImport
  if (!isPptxImportOutcome(documentImport)) return failure(format, 'invalid')
  const textReady = documentImport.status === 'ready'
  if (textReady !== (typeof text === 'string')) return failure(format, 'invalid')
  const presentationImport = parsePresentationImportResult(value.presentationImport)
  return { ...(textReady ? { text } : {}), documentImport: { format, status: documentImport.status }, presentationImport }
}
