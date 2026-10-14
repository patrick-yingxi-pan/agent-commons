import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { prepareUiHostFiles } from './imageAttachments.ts'
import { localGitSavedCopies, newLocalGitSavedCopyId } from './localGitSavedCopies.ts'
import type { LocalSavedCopySourceKind } from './localGitSavedCopiesCore.ts'
import { createLocalFileSavedCopyCore, isPreparedLocalFileSavedCopy, type PreparedLocalFileSavedCopy } from './localFileSavedCopyCore.ts'

const core = createLocalFileSavedCopyCore()
const controllers = new Map<string, AbortController>()
onAccountSwitch(() => {
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
})

export interface LocalFileSavedCopyArgs {
  scope: string
  connectionId: string
  receipt: number
  sourceKind: LocalSavedCopySourceKind
  preview: LocalBrowsePreview
  isCurrent(): boolean
  subscribeCurrent(listener: () => void): () => void
  onAttach(file: PreparedLocalFileSavedCopy): unknown | Promise<unknown>
}

/** Shared saved-copy path for folder/Git previews and captured comparisons.
 * The registry supplies the existing target-qualified opaque ID and coalesces
 * duplicate clicks/remounts; this controller uploads an image only after an
 * explicit Attach and fences all work until context publication begins. */
export const localFileSavedCopy = {
  submit(args: LocalFileSavedCopyArgs): Promise<unknown> {
    const generation = accountGeneration()
    const key = JSON.stringify([args.scope, args.sourceKind, args.connectionId, args.receipt])
    const submitted = localGitSavedCopies.submit(args.scope, args.connectionId, args.receipt, newLocalGitSavedCopyId, savedId => {
      const controller = new AbortController()
      controllers.set(key, controller)
      const isCurrent = () => generation === accountGeneration() && args.isCurrent()
      return core.submit({
        savedId,
        preview: args.preview,
        controller,
        isCurrent,
        subscribeCurrent: args.subscribeCurrent,
        prepare: async (file, signal) => {
          const prepared = await prepareUiHostFiles([file], signal)
          const ready = prepared[0]
          if (!ready) return null
          if (!isPreparedLocalFileSavedCopy(ready)) throw new Error('The selected copy was not ready to attach. Try again.')
          return ready
        },
        onAttach: args.onAttach,
      }).finally(() => {
        if (controllers.get(key) === controller) controllers.delete(key)
      })
    }, args.sourceKind)
    return submitted.promise
  },
}
