import { IMAGE_MAX_CONTAINER_BYTES, isImageSnapshot, type ImageSnapshot } from '../../contract/imageInput.ts'
import { imageAssetRefMatches } from '../../contract/imageAssets.ts'
import { isServedImageFileName, isServedImageSnapshot, SERVED_IMAGE_SNAPSHOT_MAX_DIMENSION, type ServedImageSnapshot } from '../../contract/servedImageSnapshot.ts'
import { isServedPath, isServedSourceId, isSnapshotId } from '../../contract/servedTextSnapshot.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { readFsBinaryBytes } from '../api/fsBinaryBytes.ts'
import { uploadImageSnapshot } from '../api/imageAssets.ts'
import { importImage } from '../lib/imageImport.ts'

interface CaptureDependencies {
  read?: typeof readFsBinaryBytes
  normalize?: typeof importImage
  upload?: typeof uploadImageSnapshot
}

/** One explicit intent owns its normalized bytes even if upload acknowledgement
 * is lost. Retry can re-upload those bytes but cannot silently recapture a newer
 * source. The original file is transient and never enters the asset store. */
export function createServedImageCapture(sourceId: string, path: string, snapshotId: string, deps: CaptureDependencies = {}) {
  const generation = accountGeneration()
  let captured: { capturedAt: string; image: ImageSnapshot } | undefined
  let saved: ServedImageSnapshot | undefined
  return async (signal?: AbortSignal): Promise<ServedImageSnapshot> => {
    if (!isServedSourceId(sourceId) || !isServedPath(path) || !isSnapshotId(snapshotId) || !isServedImageFileName(path)) {
      throw new Error('This image source is invalid. Nothing was saved.')
    }
    const controller = new AbortController()
    const unsubscribe = onAccountSwitch(() => controller.abort())
    const intake = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
    const assertCurrent = () => {
      if (generation !== accountGeneration()) throw new Error('Your account changed. Nothing was saved.')
      intake.throwIfAborted()
    }
    try {
      assertCurrent()
      if (saved) return saved
      if (!captured) {
        const bytes = await (deps.read ?? readFsBinaryBytes)(sourceId, path, IMAGE_MAX_CONTAINER_BYTES, intake)
        assertCurrent()
        const capturedAt = new Date().toISOString()
        const image = await (deps.normalize ?? importImage)(bytes, intake)
        assertCurrent()
        if (!isImageSnapshot(image) || image.mimeType !== 'image/png' || image.width > SERVED_IMAGE_SNAPSHOT_MAX_DIMENSION || image.height > SERVED_IMAGE_SNAPSHOT_MAX_DIMENSION) {
          throw new Error('The image returned an invalid saved copy. Nothing was saved.')
        }
        captured = { capturedAt, image }
      }
      const image = await (deps.upload ?? uploadImageSnapshot)(captured.image, intake)
      assertCurrent()
      const snapshot = { version: 1 as const, snapshotId, capturedAt: captured.capturedAt, sourceId, path, image }
      if (!isServedImageSnapshot(snapshot) || !imageAssetRefMatches(image, captured.image)) {
        throw new Error('The image upload did not match the saved copy. Nothing was attached.')
      }
      saved = snapshot
      return snapshot
    } finally {
      controller.abort()
      unsubscribe()
    }
  }
}
