/** Shared bounds and closed results for explicitly requested, device-local PDF
 * OCR. Only transient PDF bytes and a reviewed text result cross the seam. */
export const PDF_OCR_MAX_INPUT_BYTES = 8 * 1024 * 1024
export const PDF_OCR_MAX_PAGES = 100
export const PDF_OCR_MAX_EDGE = 2_000
export const PDF_OCR_MAX_TEXT_BYTES = 64 * 1024
export const PDF_OCR_MAX_OUTPUT_BYTES = PDF_OCR_MAX_TEXT_BYTES * 6 + 1024
export const PDF_OCR_TIMEOUT_MS = 120_000
export const PDF_OCR_CAPACITY = 1

const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const RESULT_FAILURES = new Set(['invalid', 'too-large', 'page-limit', 'protected', 'unavailable', 'busy', 'cancelled', 'timeout'])
const HELPER_FAILURES = new Set(['invalid', 'too-large', 'page-limit', 'protected', 'unavailable'])

function utf8Length(text) {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined
      index += 1
      bytes += 4
    } else if (code >= 0xdc00 && code <= 0xdfff) return undefined
    else if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else bytes += 3
    if (bytes > PDF_OCR_MAX_TEXT_BYTES) return bytes
  }
  return bytes
}

/** Detaches a bounded PDF byte snapshot; native parsing remains authoritative. */
export function snapshotPdfOcrInput(value) {
  try {
    if (!(value instanceof Uint8Array) || (typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer)) {
      return { status: 'invalid' }
    }
    if (value.byteLength > PDF_OCR_MAX_INPUT_BYTES) return { status: 'too-large' }
    if (value.byteLength < 8) return { status: 'invalid' }
    const headerEnd = Math.min(value.byteLength - HEADER.length, 1024)
    let hasHeader = false
    for (let start = 0; start <= headerEnd; start += 1) {
      if (HEADER.every((byte, offset) => value[start + offset] === byte)) { hasHeader = true; break }
    }
    if (!hasHeader) return { status: 'invalid' }
    return { status: 'ready', pdf: new Uint8Array(value) }
  } catch {
    return { status: 'invalid' }
  }
}

function validText(text) {
  if (typeof text !== 'string' || !text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return false
  const bytes = utf8Length(text)
  return bytes !== undefined && bytes > 0 && bytes <= PDF_OCR_MAX_TEXT_BYTES
}

function validPageCount(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= PDF_OCR_MAX_PAGES
}

/** Validates a closed host result, including runner-owned failure statuses. */
export function isPdfOcrResult(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const keys = Object.keys(value).sort().join(',')
    if (keys === 'status' && RESULT_FAILURES.has(value.status)) return true
    if (value.status === 'ready' && keys === 'pages,status,text,textPages') {
      return validPageCount(value.pages) && Number.isSafeInteger(value.textPages) && value.textPages >= 1 &&
        value.textPages <= value.pages && validText(value.text)
    }
    if (value.status === 'no-text' && keys === 'pages,status,textPages') {
      return validPageCount(value.pages) && value.textPages === 0
    }
    return false
  } catch {
    return false
  }
}

/** The native protocol cannot report host-only busy, cancellation, or timeout. */
export function isPdfOcrHelperResult(value) {
  try {
    if (!isPdfOcrResult(value)) return false
    return value.status === 'ready' || value.status === 'no-text' || HELPER_FAILURES.has(value.status)
  } catch {
    return false
  }
}
