/** Shared, device-local image OCR bounds and closed result validation. This
 * contract carries PNG bytes only at the native bridge; it grants no path,
 * network, persistence, or model authority. */
export const IMAGE_OCR_MAX_INPUT_BYTES = 3 * 1024 * 1024
export const IMAGE_OCR_MAX_EDGE = 2_000
export const IMAGE_OCR_MAX_TEXT_BYTES = 64 * 1024
export const IMAGE_OCR_MAX_OUTPUT_BYTES = IMAGE_OCR_MAX_TEXT_BYTES * 6 + 128
export const IMAGE_OCR_TIMEOUT_MS = 30_000
export const IMAGE_OCR_CAPACITY = 2

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const RESULT_FAILURES = new Set(['no-text', 'invalid', 'too-large', 'unavailable', 'busy', 'cancelled', 'timeout'])
const HELPER_FAILURES = new Set(['no-text', 'invalid', 'too-large', 'unavailable'])

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
    if (bytes > IMAGE_OCR_MAX_TEXT_BYTES) return bytes
  }
  return bytes
}

/** Detached bounded snapshot for the native OCR bridge. The helper remains the
 * final complete-PNG decoder and independently checks ImageIO admission. */
export function snapshotImageOcrInput(value) {
  try {
    if (!(value instanceof Uint8Array) || (typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer)) {
      return { status: 'invalid' }
    }
    if (value.byteLength > IMAGE_OCR_MAX_INPUT_BYTES) return { status: 'too-large' }
    if (value.byteLength < 33) return { status: 'invalid' }
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) if (value[index] !== PNG_SIGNATURE[index]) return { status: 'invalid' }
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
    if (view.getUint32(8, false) !== 13 || value[12] !== 73 || value[13] !== 72 || value[14] !== 68 || value[15] !== 82) {
      return { status: 'invalid' }
    }
    const width = view.getUint32(16, false)
    const height = view.getUint32(20, false)
    if (!width || !height) return { status: 'invalid' }
    if (width > IMAGE_OCR_MAX_EDGE || height > IMAGE_OCR_MAX_EDGE) return { status: 'too-large' }
    return { status: 'ready', png: new Uint8Array(value) }
  } catch {
    return { status: 'invalid' }
  }
}

/** Validates every renderer/native-bridge result as one whole path-free value. */
export function isImageOcrResult(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const keys = Object.keys(value).sort().join(',')
    if (keys === 'status' && RESULT_FAILURES.has(value.status)) return true
    if (keys !== 'status,text' || value.status !== 'ready' || typeof value.text !== 'string' || !value.text.trim() ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text)) return false
    const bytes = utf8Length(value.text)
    return bytes !== undefined && bytes > 0 && bytes <= IMAGE_OCR_MAX_TEXT_BYTES
  } catch {
    return false
  }
}

/** The native helper protocol has only four failure results. Runner and host
 * outcomes such as busy/cancelled/timeout are not valid helper responses. */
export function isImageOcrHelperResult(value) {
  try {
    if (!isImageOcrResult(value)) return false
    return value.status === 'ready' || HELPER_FAILURES.has(value.status)
  } catch {
    return false
  }
}
