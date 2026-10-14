/** Filename admission and raw transport budgets shared by native and renderer
 * image intake. This is metadata policy only; it does not decode image data. */
export const IMAGE_FILE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_SELECTION_MAX_BYTES = 24 * 1024 * 1024

const IMAGE_TYPES = Object.freeze([
  Object.freeze({ extension: 'bmp', mimeType: 'image/bmp' }),
  Object.freeze({ extension: 'gif', mimeType: 'image/gif' }),
  Object.freeze({ extension: 'ico', mimeType: 'image/x-icon' }),
  Object.freeze({ extension: 'jpeg', mimeType: 'image/jpeg' }),
  Object.freeze({ extension: 'jpg', mimeType: 'image/jpeg' }),
  Object.freeze({ extension: 'png', mimeType: 'image/png' }),
  Object.freeze({ extension: 'svg', mimeType: 'image/svg+xml' }),
  Object.freeze({ extension: 'webp', mimeType: 'image/webp' }),
])

const TYPES_BY_EXTENSION = new Map(IMAGE_TYPES.map(({ extension, mimeType }) => [extension, mimeType]))

export function imageMimeForFileName(name) {
  if (typeof name !== 'string') return undefined
  const basename = name.slice(name.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return undefined
  return TYPES_BY_EXTENSION.get(basename.slice(dot + 1).toLowerCase())
}

export function isImageFileName(name) {
  return imageMimeForFileName(name) !== undefined
}

export function imageFileExtensions() {
  return IMAGE_TYPES.map(({ extension }) => extension)
}
