/** Read-only visible slide text. Package bytes, paths, media, notes and
 * executable/remote content never enter product state. */
export const MAX_PPTX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_PPTX_SELECTION_BYTES = 24 * 1024 * 1024
export const MAX_PPTX_TEXT_BYTES = 64 * 1024
export const MAX_PPTX_ENTRIES = 512
export const MAX_PPTX_PART_BYTES = 4 * 1024 * 1024
export const MAX_PPTX_EXPANDED_BYTES = 16 * 1024 * 1024
export const MAX_PPTX_SLIDES = 128
export const PPTX_IMPORT_TIMEOUT_MS = 15_000

export const isPptxFileName = (name) => typeof name === 'string' && /\.pptx$/i.test(name)
export const pptxImportFailure = (status) => ({ documentImport: { format: 'pptx', status } })
const statuses = ['ready', 'no-text', 'file-too-large', 'selection-limit', 'text-limit', 'structure-limit', 'unsupported', 'timeout', 'invalid', 'unavailable']
export function isPptxImportOutcome(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && Object.hasOwn(value, 'format') && Object.hasOwn(value, 'status') &&
    value.format === 'pptx' && statuses.includes(value.status)
}
export function pptxImportCopy(outcome) {
  if (!outcome || outcome.format !== 'pptx') return ''
  switch (outcome.status) {
    case 'ready': return 'Visible slide text from ordinary text boxes and tables in file reading order. Hidden slides/shapes, speaker notes, comments, layouts, masters, images, charts, SmartArt and animation are not included.'
    case 'no-text': return 'No readable text was found on visible slides. Add text to a visible slide or export the needed content as PDF.'
    case 'file-too-large': return 'Presentation not imported. Choose a .pptx file up to 8 MB.'
    case 'selection-limit': return 'Presentation not imported. Choose up to 24 MB of documents at a time.'
    case 'text-limit': return 'Presentation not imported. Extracted slide text exceeds 64 KB; split the presentation. No partial text was saved.'
    case 'structure-limit': return 'Presentation not imported. Its expanded content, slides or package structure exceed the import limits.'
    case 'unsupported': return 'Presentation not imported. Save an unlocked .pptx copy; legacy and macro-enabled presentations are not supported.'
    case 'timeout': return 'Presentation import took too long. Try a smaller presentation.'
    case 'invalid': return 'Presentation not imported. It could not be read reliably; save a new .pptx copy and try again.'
    default: return 'Presentation import is unavailable. Try again.'
  }
}
