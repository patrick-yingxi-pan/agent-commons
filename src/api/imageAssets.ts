import type { ImageAssetRef } from '../../contract/imageAssets.ts'
import type { ImageSnapshot } from '../../contract/imageInput.ts'
import type { ImageOriginal } from '../../contract/imageOriginal.ts'
import { apiGet, apiPost, apiUrl } from './client.ts'
import type { ImageOriginalDownload, ImageOriginalInfo } from '../../contract/imageOriginal.ts'
import { paths, keys } from './keys.ts'
import { peek } from './cache.ts'
import type { Identity } from '../../contract/identity.ts'

export async function uploadImageSnapshot(snapshot: ImageSnapshot, signal?: AbortSignal, original?: ImageOriginal): Promise<ImageAssetRef> {
  // The shared client owns auth/account fencing; the signal is an intake fence
  // and is checked before issuing the durable upload.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const identity = peek<Identity>(keys.me)
  if (!identity) throw new Error('Wait for your account to load before adding an image.')
  return apiPost<ImageAssetRef>(paths.imageAssets, original ? { image: snapshot, original } : snapshot, {
    signal, expectedSessionUserId: identity.via === 'session' ? identity.user.id : null,
  })
}

export function imageAssetContentUrl(id: string): string {
  return apiUrl(paths.imageAssetContent(id))
}

function originalReadOptions(signal?: AbortSignal) {
  const identity = peek<Identity>(keys.me)
  if (!identity) throw new Error('Wait for your account to load before downloading an image.')
  return { signal, expectedSessionUserId: identity.via === 'session' ? identity.user.id : null }
}

export function readImageOriginalInfo(id: string, signal?: AbortSignal): Promise<ImageOriginalInfo> {
  return apiGet(`${paths.imageAssetOriginal(id)}?metadata=1`, originalReadOptions(signal))
}

export function readImageOriginal(id: string, signal?: AbortSignal): Promise<ImageOriginalDownload> {
  return apiGet(paths.imageAssetOriginal(id), originalReadOptions(signal))
}
