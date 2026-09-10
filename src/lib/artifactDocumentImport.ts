import { isDocxFileName, isDocxImportOutcome } from '../../contract/docxImport.mjs'
import { documentImportCopy } from '../../contract/documentImport.mjs'
import { isPdfFileName, isPdfImportOutcome } from '../../contract/pdfImport.mjs'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import { isLocalTextFileName } from '../../contract/localTextFile.mjs'
import { normalizeArtifactName } from '../../contract/artifactMetadata.ts'
import type { UiHostFile } from './uiHostFs.ts'

export type ArtifactDocumentImportResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string; text: string; disclosure?: string }

function importedName(name: string): string {
  const leaf = name.trim().split(/[\\/]/).at(-1) ?? ''
  const dot = leaf.lastIndexOf('.')
  const candidate = `${dot > 0 ? leaf.slice(0, dot) : leaf}.md`
  return normalizeArtifactName(candidate) ?? 'imported-document.md'
}

function errorFor(file: Pick<UiHostFile, 'documentImport'>, fallback: string, format?: 'pdf' | 'docx'): ArtifactDocumentImportResult {
  const outcome = file.documentImport
  const validFailure = format === 'pdf'
    ? isPdfImportOutcome(outcome) && outcome.status !== 'ready'
    : format === 'docx'
      ? isDocxImportOutcome(outcome) && outcome.status !== 'ready'
      : false
  const message = validFailure
    ? documentImportCopy(outcome).replace(/\breattach\b/gi, 'choose again for import').replace(/\battach\b/gi, 'choose')
    : fallback
  return { status: 'error', message: message || fallback }
}

export function isArtifactDocumentFileName(name: string): boolean {
  return isLocalTextFileName(name) || isPdfFileName(name) || isDocxFileName(name)
}

/** Normalize one selected bounded file into the existing document authoring
 * draft. This deliberately accepts only text/PDF/DOCX: spreadsheet and slide
 * imports need a structured mapping contract rather than a flattened body. */
export function reviewArtifactDocumentImport(
  files: readonly Pick<UiHostFile, 'name' | 'kind' | 'text' | 'documentImport'>[],
): ArtifactDocumentImportResult {
  if (files.length === 0) return { status: 'cancelled' }
  if (files.length !== 1) return { status: 'error', message: 'Choose one document to import.' }

  const file = files[0]
  if (file.kind !== 'file') return { status: 'error', message: 'Photos cannot be imported as document artifacts.' }

  const pdfFile = isPdfFileName(file.name)
  const docxFile = isDocxFileName(file.name)
  if (!isArtifactDocumentFileName(file.name)) {
    return { status: 'error', message: 'Choose a text file, PDF, or DOCX document.' }
  }

  if (typeof file.text !== 'string' || !file.text.trim()) {
    return pdfFile || docxFile
      ? errorFor(file, 'No readable document text was found.', pdfFile ? 'pdf' : 'docx')
      : { status: 'error', message: 'The selected text file has no readable content.' }
  }
  if (file.text.length > MAX_AUTHORED_DOCUMENT_SOURCE_CHARS) {
    return { status: 'error', message: `Document text exceeds the ${MAX_AUTHORED_DOCUMENT_SOURCE_CHARS.toLocaleString()} character authoring limit.` }
  }

  if (pdfFile && (!isPdfImportOutcome(file.documentImport) || file.documentImport.status !== 'ready')) {
    return errorFor(file, 'The PDF import did not produce a complete text snapshot.', 'pdf')
  }
  if (docxFile && (!isDocxImportOutcome(file.documentImport) || file.documentImport.status !== 'ready')) {
    return errorFor(file, 'The DOCX import did not produce a complete text snapshot.', 'docx')
  }

  const disclosure = pdfFile || docxFile ? documentImportCopy(file.documentImport) : undefined
  return disclosure
    ? { status: 'ready', name: importedName(file.name), text: file.text, disclosure }
    : { status: 'ready', name: importedName(file.name), text: file.text }
}
