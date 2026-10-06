export const IMAGE_OCR_MAX_INPUT_BYTES: number
export const IMAGE_OCR_MAX_EDGE: number
export const IMAGE_OCR_MAX_TEXT_BYTES: number
export const IMAGE_OCR_MAX_OUTPUT_BYTES: number
export const IMAGE_OCR_TIMEOUT_MS: number
export const IMAGE_OCR_CAPACITY: number

export type ImageOcrFailureStatus = 'no-text' | 'invalid' | 'too-large' | 'unavailable' | 'busy' | 'cancelled' | 'timeout'
export type ImageOcrResult = { status: 'ready'; text: string } | { status: ImageOcrFailureStatus }
export type ImageOcrInputSnapshot = { status: 'ready'; png: Uint8Array } | { status: 'invalid' | 'too-large' }

export interface NativeImageOcrBridge {
  recognize(operationId: string, png: Uint8Array): Promise<ImageOcrResult>
  cancel(operationId: string): Promise<boolean>
}

export function snapshotImageOcrInput(value: unknown): ImageOcrInputSnapshot
export function isImageOcrResult(value: unknown): value is ImageOcrResult
export function isImageOcrHelperResult(value: unknown): boolean
