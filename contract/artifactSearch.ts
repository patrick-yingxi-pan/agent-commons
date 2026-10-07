import type { ArtifactContent } from './content.ts'

export interface ArtifactSearchTarget {
  revision: number
  field: string
}

const index = '(?:0|[1-9]\\d*)'
const fieldPattern = new RegExp(
  `^(?:doc\\.title|doc\\.block\\.${index}\\.(?:h|p|ul\\.${index}|code\\.${index}|email\\.(?:to|subject))|` +
    `sheet\\.(?:column\\.${index}|cell\\.${index}\\.${index}|note)|` +
    `workbook\\.${index}\\.(?:name|column\\.${index}|cell\\.${index}\\.${index}|note)|` +
    `slides\\.${index}\\.(?:title|bullet\\.${index}))$`,
)

function safeIndex(value: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false
  return Number.isSafeInteger(Number(value))
}

/** True only for a canonical path to one authored string field. */
export function validArtifactSearchField(value: unknown): value is string {
  if (typeof value !== 'string' || !fieldPattern.test(value)) return false
  return value.split('.').every((part) => !/^\d/.test(part) || safeIndex(part))
}

/** Parse the stable `${revision}/${field}` token used to address a search match. */
export function parseArtifactSearchTarget(value: string | null | undefined): ArtifactSearchTarget | undefined {
  if (typeof value !== 'string') return undefined
  const slash = value.indexOf('/')
  if (slash <= 0 || slash !== value.lastIndexOf('/')) return undefined
  const revisionText = value.slice(0, slash)
  if (!safeIndex(revisionText)) return undefined
  const field = value.slice(slash + 1)
  if (!validArtifactSearchField(field)) return undefined
  return { revision: Number(revisionText), field }
}

/** Build a stable target key, refusing malformed runtime values instead of
 * smuggling arbitrary text into an address or cache key. */
export function artifactSearchTargetKey(target: ArtifactSearchTarget): string {
  if (!target || !safeIndex(String(target.revision)) || !Number.isSafeInteger(target.revision) ||
    target.revision < 0 || !validArtifactSearchField(target.field)) {
    throw new TypeError('Invalid Artifact search target.')
  }
  return `${target.revision}/${target.field}`
}

function* field(field: string, text: unknown): Generator<{ field: string; text: string }> {
  if (typeof text === 'string') yield { field, text }
}

/** Visit authored string fields in the same order used by Artifact search. */
export function* artifactSearchFields(body: ArtifactContent): Generator<{ field: string; text: string }> {
  switch (body.type) {
    case 'doc':
      yield* field('doc.title', body.title)
      for (const [blockIndex, block] of body.blocks.entries()) {
        if ('h' in block) yield* field(`doc.block.${blockIndex}.h`, block.h)
        else if ('p' in block) yield* field(`doc.block.${blockIndex}.p`, block.p)
        else if ('ul' in block) {
          for (const [lineIndex, text] of block.ul.entries()) yield* field(`doc.block.${blockIndex}.ul.${lineIndex}`, text)
        } else if ('code' in block) {
          for (const [lineIndex, text] of block.code.entries()) yield* field(`doc.block.${blockIndex}.code.${lineIndex}`, text)
        } else {
          yield* field(`doc.block.${blockIndex}.email.to`, block.email.to)
          yield* field(`doc.block.${blockIndex}.email.subject`, block.email.subject)
        }
      }
      return
    case 'sheet':
      for (const [columnIndex, text] of body.columns.entries()) yield* field(`sheet.column.${columnIndex}`, text)
      for (const [rowIndex, row] of body.rows.entries()) {
        for (const [columnIndex, text] of row.entries()) yield* field(`sheet.cell.${rowIndex}.${columnIndex}`, text)
      }
      if (body.note !== undefined) yield* field('sheet.note', body.note)
      return
    case 'workbook':
      for (const [sheetIndex, sheet] of body.sheets.entries()) {
        yield* field(`workbook.${sheetIndex}.name`, sheet.name)
        for (const [columnIndex, text] of sheet.columns.entries()) yield* field(`workbook.${sheetIndex}.column.${columnIndex}`, text)
        for (const [rowIndex, row] of sheet.rows.entries()) {
          for (const [columnIndex, text] of row.entries()) yield* field(`workbook.${sheetIndex}.cell.${rowIndex}.${columnIndex}`, text)
        }
        if (sheet.note !== undefined) yield* field(`workbook.${sheetIndex}.note`, sheet.note)
      }
      return
    case 'slides':
      for (const [slideIndex, slide] of body.slides.entries()) {
        yield* field(`slides.${slideIndex}.title`, slide.title)
        for (const [bulletIndex, text] of slide.bullets.entries()) yield* field(`slides.${slideIndex}.bullet.${bulletIndex}`, text)
      }
      return
    case 'figure':
      // Captions, labels and numeric series are not part of the text search projection.
      return
  }
}
