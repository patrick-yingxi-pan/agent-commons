import { createOcrHost } from './ocrHost.mjs'
import { createPdfOcrRunner, pdfOcrExecutable } from './pdfOcr.mjs'
import { PDF_OCR_CAPACITY, PDF_OCR_MAX_INPUT_BYTES, isPdfOcrResult } from '../contract/pdfOcr.mjs'

export function createPdfOcrHost({ targetPlatform = process.platform, packaged = false, resourcesPath,
  executable = pdfOcrExecutable({ packaged, resourcesPath, targetPlatform }),
  runner = createPdfOcrRunner({ executable, targetPlatform }), assertCaller, isClosing,
} = {}) {
  return createOcrHost({ runner, targetPlatform, assertCaller, isClosing,
    capacity: PDF_OCR_CAPACITY, maxInputBytes: PDF_OCR_MAX_INPUT_BYTES, isResult: isPdfOcrResult })
}
