import { isImageAssetRef, type ImageAssetRef } from './imageAssets.ts'
import { isClosedRecord } from './closedRecord.mjs'
import { isServedCaptureTime, isServedPath, isServedSourceId, isSnapshotId } from './servedSnapshotIdentity.ts'

/** Captured, normalized served image data; the path is provenance, not a read grant. */
export interface ServedImageSnapshotV1 {
  version: 1
  snapshotId: string
  capturedAt: string
  sourceId: string
  path: string
  image: ImageAssetRef
}

export type ServedImageSnapshot = ServedImageSnapshotV1

export const SERVED_IMAGE_SNAPSHOT_MAX_DIMENSION = 2000

/** The served filesystem catalog's supported image suffixes, with a real dot. */
export function isServedImageFileName(name: unknown): name is string {
  return typeof name === 'string' && /\.(?:png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(name)
}

export function isServedImageSnapshot(value: unknown): value is ServedImageSnapshot {
  const fields = ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'image']
  if (!isClosedRecord(value, fields, 'all')) return false
  const item = value as Record<string, unknown>
  if (item.version !== 1 || !isSnapshotId(item.snapshotId) || !isServedCaptureTime(item.capturedAt) ||
      !isServedSourceId(item.sourceId) || !isServedPath(item.path) || !isServedImageFileName(item.path)) return false
  if (!isImageAssetRef(item.image)) return false
  const image = item.image as ImageAssetRef
  const imageKeys = Reflect.ownKeys(image)
  return imageKeys.length === (image.originalByteLength === undefined ? 5 : 6) && imageKeys.every((key) =>
    typeof key === 'string' && ['id', 'mimeType', 'width', 'height', 'byteLength', 'originalByteLength'].includes(key)) &&
    image.mimeType === 'image/png' && image.width <= SERVED_IMAGE_SNAPSHOT_MAX_DIMENSION &&
    image.height <= SERVED_IMAGE_SNAPSHOT_MAX_DIMENSION
}
