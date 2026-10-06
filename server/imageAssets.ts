import { createHash } from 'node:crypto'
import { ValidationError } from './conflict.ts'
import { IMAGE_MAX_BYTES, isImageSnapshot, type ImageSnapshot } from '../contract/imageInput.ts'
import { isImageOriginal, type ImageOriginal } from '../contract/imageOriginal.ts'

export const IMAGE_ASSET_MAX_TENANT_BYTES = 64 * 1024 * 1024
export const IMAGE_ASSET_MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const IMAGE_ASSET_MAX_COUNT = 4096

export interface ImageAssetRow {
  readonly id: string
  readonly tenantId: string
  readonly image: ImageSnapshot
  readonly createdAt: number
  readonly original?: ImageOriginal
}

export interface ImageAssetRegistryOptions {
  maxTenantBytes?: number
  maxTotalBytes?: number
  maxCount?: number
}

const copyImage = (image: ImageSnapshot): ImageSnapshot => ({ ...image })
const copyRow = (row: ImageAssetRow): ImageAssetRow => ({ ...row, image: copyImage(row.image), ...(row.original ? { original: { ...row.original } } : {}) })
const rowBytes = (row: ImageAssetRow) => row.image.byteLength + (row.original?.byteLength ?? 0)

function validTenant(tenantId: string): boolean {
  return typeof tenantId === 'string' && tenantId.trim().length > 0 && tenantId.length <= 256
}

function assetId(tenantId: string, image: ImageSnapshot, original?: ImageOriginal): string {
  // Preserve the exact legacy address. New originals are immutable bindings,
  // not mutable metadata on a deduplicated normalized preview.
  const canonical = JSON.stringify([tenantId, image.mimeType, image.data, image.width, image.height, image.byteLength,
    ...(original ? [original.name, original.data, original.byteLength] : [])])
  return `img-${createHash('sha256').update(canonical).digest('hex')}`
}

export class ImageAssetRegistry {
  readonly #rows = new Map<string, ImageAssetRow>()
  readonly #tenantBytes = new Map<string, number>()
  #totalBytes = 0
  readonly #maxTenantBytes: number
  readonly #maxTotalBytes: number
  readonly #maxCount: number

  constructor(rows: ReadonlyArray<ImageAssetRow> = [], options: ImageAssetRegistryOptions = {}) {
    this.#maxTenantBytes = options.maxTenantBytes ?? IMAGE_ASSET_MAX_TENANT_BYTES
    this.#maxTotalBytes = options.maxTotalBytes ?? IMAGE_ASSET_MAX_TOTAL_BYTES
    this.#maxCount = options.maxCount ?? IMAGE_ASSET_MAX_COUNT
    if (![this.#maxTenantBytes, this.#maxTotalBytes, this.#maxCount].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new ValidationError('Image asset limits must be positive safe integers.')
    }
    for (const row of rows) this.#insert(row)
  }

  #insert(input: ImageAssetRow): ImageAssetRow {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== (input.original === undefined ? 4 : 5) ||
        (input.original !== undefined && !isImageOriginal(input.original)) || !validTenant(input.tenantId) || !isImageSnapshot(input.image) || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
      throw new ValidationError('Invalid image asset row.')
    }
    const id = assetId(input.tenantId, input.image, input.original)
    if (input.id !== id) throw new ValidationError('Image asset id does not match its content.')
    const existing = this.#rows.get(id)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(input)) throw new ValidationError('Duplicate image asset id has different content.')
      return existing
    }
    const bytes = rowBytes(input)
    const tenantBytes = this.#tenantBytes.get(input.tenantId) ?? 0
    if (this.#rows.size >= this.#maxCount) throw new ValidationError('Image asset count limit exceeded.')
    if (tenantBytes + bytes > this.#maxTenantBytes) throw new ValidationError('Image asset tenant byte limit exceeded.')
    if (this.#totalBytes + bytes > this.#maxTotalBytes) throw new ValidationError('Image asset total byte limit exceeded.')
    const row = copyRow(input)
    this.#rows.set(id, row)
    this.#tenantBytes.set(input.tenantId, tenantBytes + bytes)
    this.#totalBytes += bytes
    return row
  }

  put(tenantId: string, image: ImageSnapshot, createdAt = Date.now(), original?: ImageOriginal): ImageAssetRow {
    if (!validTenant(tenantId) || !isImageSnapshot(image) || image.byteLength > IMAGE_MAX_BYTES || (original !== undefined && !isImageOriginal(original))) {
      throw new ValidationError('Invalid image asset.')
    }
    const id = assetId(tenantId, image, original)
    const existing = this.#rows.get(id)
    if (existing) return copyRow(existing)
    return copyRow(this.#insert({ id, tenantId, image, createdAt, ...(original ? { original } : {}) }))
  }

  get(id: string): ImageAssetRow | undefined {
    const row = this.#rows.get(id)
    return row && copyRow(row)
  }

  snapshot(): ImageAssetRow[] {
    return [...this.#rows.values()].map(copyRow)
  }

  remove(ids: readonly string[]): number {
    let removed = 0
    for (const id of ids) {
      const row = this.#rows.get(id)
      if (!row) continue
      this.#rows.delete(id)
      const remaining = (this.#tenantBytes.get(row.tenantId) ?? rowBytes(row)) - rowBytes(row)
      if (remaining > 0) this.#tenantBytes.set(row.tenantId, remaining)
      else this.#tenantBytes.delete(row.tenantId)
      this.#totalBytes -= rowBytes(row)
      removed++
    }
    return removed
  }
}

export function rehydrateImageAssets(rows: readonly ImageAssetRow[] | undefined): ImageAssetRegistry {
  return new ImageAssetRegistry(rows ?? [])
}
