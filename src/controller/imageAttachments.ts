import type { UiHostFile } from '../lib/uiHostFs'
import { uploadImageSnapshot } from '../api/imageAssets.ts'
import { accountGeneration } from '../api/account.ts'
import { imageAssetRefMatches, isImageAssetRef } from '../../contract/imageAssets.ts'

export interface ImageAttachmentDeps {
  upload?: typeof uploadImageSnapshot
  generation?: () => number
}

/** Persist normalized image snapshots serially before attachment projection. */
export async function prepareUiHostFiles(files: UiHostFile[], signal?: AbortSignal, deps: ImageAttachmentDeps = {}): Promise<UiHostFile[]> {
  const upload = deps.upload ?? uploadImageSnapshot
  const generation = deps.generation ?? accountGeneration
  const issued = generation()
  const prepared: UiHostFile[] = []
  for (const file of files) {
    if (signal?.aborted || generation() !== issued) return []
    if (!file.imageInput) { prepared.push({ ...file, imageOriginal: undefined }); continue }
    const image = await upload(file.imageInput, signal, file.imageOriginal)
    if (signal?.aborted || generation() !== issued) return []
    if (!isImageAssetRef(image) || !imageAssetRefMatches(image, file.imageInput, file.imageOriginal)) throw new Error('The saved image did not match the selected copy. Try again.')
    prepared.push({ ...file, image, imageInput: undefined, imageOriginal: undefined })
  }
  return prepared
}
