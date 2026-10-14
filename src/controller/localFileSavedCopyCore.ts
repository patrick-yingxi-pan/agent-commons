import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import type { UiHostFile } from '../lib/uiHostFs.ts'
import type { ImageAssetRef } from '../../contract/imageAssets.ts'

export type PreparedLocalFileSavedCopy =
  | (Omit<UiHostFile, 'kind' | 'image' | 'imageInput' | 'imageOriginal' | 'text'> & { kind: 'photo'; image: ImageAssetRef; imageInput?: never; imageOriginal?: never })
  | (Omit<UiHostFile, 'kind' | 'image' | 'imageInput' | 'imageOriginal' | 'text'> & { kind: 'file'; text: string; image?: never; imageInput?: never; imageOriginal?: never })

export function isPreparedLocalFileSavedCopy(file: UiHostFile): file is PreparedLocalFileSavedCopy {
  if (file.imageInput !== undefined || file.imageOriginal !== undefined) return false
  return file.kind === 'photo'
    ? !!file.image
    : file.kind === 'file' && typeof file.text === 'string' && file.image === undefined
}

export interface LocalFileSavedCopyRequest {
  savedId: string
  preview: LocalBrowsePreview
  controller: AbortController
  isCurrent(): boolean
  prepare(file: UiHostFile, signal: AbortSignal): Promise<PreparedLocalFileSavedCopy | null>
  onAttach(file: PreparedLocalFileSavedCopy): unknown | Promise<unknown>
  subscribeCurrent(listener: () => void): () => void
}

/** One explicit saved-copy attempt. The caller owns receipt coalescing and the
 * opaque attachment id; this layer owns pre-context cancellation and image
 * preparation. Once onAttach is entered, context mutation belongs to its
 * ordinary acknowledgement queue and is no longer cancelled here. */
export function createLocalFileSavedCopyCore() {
  return {
    async submit(request: LocalFileSavedCopyRequest): Promise<void> {
      const { controller, isCurrent } = request
      const { signal } = controller
      const stillCurrent = () => !signal.aborted && isCurrent()
      if (!stillCurrent()) return
      const unsubscribe = request.subscribeCurrent(() => {
        if (!isCurrent()) controller.abort()
      })
      try {
        if (!stillCurrent()) return
        const preview = request.preview
        const name = preview.path
        let file: UiHostFile
        if ('image' in preview.snapshot && preview.snapshot.image) {
          file = { id: request.savedId, name, kind: 'photo', imageInput: preview.snapshot.image, imageOriginal: preview.snapshot.original }
        } else if ('text' in preview.snapshot && typeof preview.snapshot.text === 'string') {
          file = { id: request.savedId, name, kind: 'file', text: preview.snapshot.text, ...(preview.documentImport && { documentImport: preview.documentImport }) }
        } else {
          throw new Error('This preview has no attachable saved copy.')
        }
        const prepared = await request.prepare(file, signal)
        if (!prepared || !stillCurrent()) return
        unsubscribe()
        await request.onAttach(prepared)
      } finally {
        unsubscribe()
      }
    },
  }
}
