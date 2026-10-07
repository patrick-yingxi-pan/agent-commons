import { createImageOcrRunner, imageOcrExecutable } from './imageOcr.mjs'
import { IMAGE_OCR_CAPACITY, IMAGE_OCR_MAX_INPUT_BYTES, isImageOcrResult } from '../contract/imageOcr.mjs'
import { createOcrHost } from './ocrHost.mjs'

export function createImageOcrHost({ targetPlatform = process.platform, packaged = false, resourcesPath,
  executable = imageOcrExecutable({ packaged, resourcesPath, targetPlatform }),
  runner = createImageOcrRunner({ executable, targetPlatform }), assertCaller, isClosing,
} = {}) {
  return createOcrHost({ runner, targetPlatform, assertCaller, isClosing,
    capacity: IMAGE_OCR_CAPACITY, maxInputBytes: IMAGE_OCR_MAX_INPUT_BYTES, isResult: isImageOcrResult })
}
