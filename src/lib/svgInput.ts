import { IMAGE_MAX_CONTAINER_BYTES, IMAGE_MAX_DIMENSION, IMAGE_MAX_PIXELS } from '../../contract/imageInput.ts'

/** Transient renderer-worker data, never an image asset or API wire format. */
export type SvgPreparation = { status: 'ready'; xml: string; width: number; height: number } |
  { status: 'invalid' | 'unsupported' | 'structure-limit' | 'file-too-large' | 'selection-limit' | 'unavailable' | 'timeout' }

export const SVG_MAX_NODES = 10_000
export const SVG_MAX_EXPANDED_NODES = 50_000
export const SVG_MAX_DEPTH = 64
export const svgFailure = (status: Exclude<SvgPreparation['status'], 'ready'>): SvgPreparation => ({ status })
export const svgDimensions = (width: number, height: number) => Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
  width > 0 && height > 0 && width <= IMAGE_MAX_DIMENSION && height <= IMAGE_MAX_DIMENSION && width * height <= IMAGE_MAX_PIXELS

export function parseSvgPreparation(value: unknown): SvgPreparation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return svgFailure('invalid')
  const entry = value as Record<string, unknown>
  if (entry.status === 'ready') {
    if (Object.keys(entry).sort().join(',') !== 'height,status,width,xml' || typeof entry.xml !== 'string' ||
        typeof entry.width !== 'number' || typeof entry.height !== 'number' || !svgDimensions(entry.width, entry.height) ||
        !entry.xml || entry.xml.length > IMAGE_MAX_CONTAINER_BYTES || new TextEncoder().encode(entry.xml).length > IMAGE_MAX_CONTAINER_BYTES) return svgFailure('invalid')
    return { status: 'ready', xml: entry.xml, width: entry.width, height: entry.height }
  }
  return Object.keys(entry).length === 1 && ['invalid', 'unsupported', 'structure-limit', 'file-too-large', 'selection-limit', 'unavailable', 'timeout'].includes(entry.status as string)
    ? svgFailure(entry.status as Exclude<SvgPreparation['status'], 'ready'>) : svgFailure('invalid')
}
