import {
  MAX_XLSX_FILE_BYTES, MAX_XLSX_ENTRIES, MAX_XLSX_PART_BYTES, MAX_XLSX_EXPANDED_BYTES, MAX_XLSX_TEXT_BYTES,
  xlsxImportFailure, type XlsxImportResult,
} from '../../contract/xlsxImport.mjs'
import { OfficeExtractionError, readOfficePackage, officeMainPart, assertOfficeContentType } from './officePackage.ts'
import { workbookMainType, worksheetType, sharedStringsType, workbookRelationships, workbookSheets, workbookStrings, worksheetValues, relationshipKind } from './xlsxText.ts'

/** Worker-only package projection. No relationship can grant network/file
 * access, and no formula, macro, chart or embedded object is executed. */
export async function extractXlsx(bytes: Uint8Array): Promise<XlsxImportResult> {
  if (bytes.byteLength > MAX_XLSX_FILE_BYTES) return xlsxImportFailure('file-too-large')
  let archive: Awaited<ReturnType<typeof readOfficePackage>> | undefined
  try {
    archive = await readOfficePackage(bytes, { maxEntries: MAX_XLSX_ENTRIES, maxPartBytes: MAX_XLSX_PART_BYTES, maxExpandedBytes: MAX_XLSX_EXPANDED_BYTES })
    const main = officeMainPart(await archive.readPart('_rels/.rels'))
    const types = await archive.readPart('[Content_Types].xml')
    assertOfficeContentType(types, main, workbookMainType)
    const sheets = workbookSheets(await archive.readPart(main))
    const slash = main.lastIndexOf('/') + 1
    const relationships = workbookRelationships(await archive.readPart(`${main.slice(0, slash)}_rels/${main.slice(slash)}.rels`), main)
    const shared = [...relationships.values()].filter((relation) => relationshipKind(relation.type, 'sharedStrings'))
    if (shared.length > 1 || shared[0]?.external) throw new OfficeExtractionError('unsupported')
    const strings = shared[0] ? (assertOfficeContentType(types, shared[0].target, sharedStringsType), workbookStrings(await archive.readPart(shared[0].target))) : []
    const targets = new Set<string>()
    const output: string[] = []
    const encoder = new TextEncoder()
    const budget = { cells: 0 }
    let used = 0
    for (const sheet of sheets) {
      const relation = relationships.get(sheet.relation)
      if (!relation) throw new OfficeExtractionError('invalid')
      if (relation.external) throw new OfficeExtractionError('unsupported')
      if (targets.has(relation.target)) throw new OfficeExtractionError('invalid')
      targets.add(relation.target)
      // Chart/dialog sheets and hidden sheets are intentionally not text input.
      if (sheet.hidden) continue
      if (!relationshipKind(relation.type, 'worksheet')) {
        if (relationshipKind(relation.type, 'chartsheet') || relationshipKind(relation.type, 'dialogsheet')) continue
        throw new OfficeExtractionError('unsupported')
      }
      assertOfficeContentType(types, relation.target, worksheetType)
      let heading = `${output.length ? '\n\n' : ''}Sheet: ${JSON.stringify(sheet.name)}\n`
      worksheetValues(await archive.readPart(relation.target), strings, budget, (address, value) => {
        const line = `${heading}${address}: ${value}\n`
        used += encoder.encode(line).byteLength
        if (used > MAX_XLSX_TEXT_BYTES) throw new OfficeExtractionError('text-limit')
        output.push(line); heading = ''
      })
    }
    return output.length ? { text: output.join(''), documentImport: { format: 'xlsx', status: 'ready' } } : { documentImport: { format: 'xlsx', status: 'no-text' } }
  } catch (error) {
    return xlsxImportFailure(error instanceof OfficeExtractionError ? error.status : 'invalid')
  } finally { await archive?.close() }
}
