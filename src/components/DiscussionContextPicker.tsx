import { useState } from 'react'
import { Check, MessageSquare, RotateCw } from 'lucide-react'
import { useMyDiscussions } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { discussionTitle } from '../../contract/social.ts'
import { discussionContextId } from '../../contract/discussionSnapshot.ts'
import type { AddedContext, Attachment } from '../types'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

/** A source-read projection is the only candidate registry. Confirmation is a
 *  disclosure step: real sessions save through onAdd, while drafts keep only a
 *  target that the first send will capture after rechecking source access. */
export function DiscussionContextPicker({
  onAdd,
  onClose,
  addedIds,
  isDraft,
}: {
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  addedIds: readonly string[]
  isDraft: boolean
}) {
  const query = useMyDiscussions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const discussions = query.status === 'success' ? query.data ?? [] : []
  const selected = discussions.find((discussion) => discussion.id === selectedId)

  if (query.status === 'loading' || query.status === 'idle') {
    return <InlineOperationStatus tone="status" message="Loading readable discussions…" action={{ label: 'Done', onClick: onClose }} />
  }
  if (query.status === 'error') {
    return <InlineOperationStatus tone="alert" message="Couldn’t load readable discussions. Nothing was added." action={{ label: 'Retry', onClick: () => invalidate(keys.myDiscussions) }} secondaryAction={{ label: 'Done', onClick: onClose }} />
  }

  if (selected) {
    const title = discussionTitle(selected.posts[0]?.body)
    return (
      <div className="space-y-2 px-1 pb-1" data-discussion-context-confirm>
        <p className="break-words text-[13px] font-medium text-ink">{title}</p>
        <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
          <p>Attach a saved copy? Everyone with access to the destination conversation can read it. Revoking access to the source later won’t erase this copy or earlier replies. It won’t update live.</p>
          {isDraft && <p className="mt-1.5">This draft will capture the copy on its first send, after checking that you can still read the source. No copy is saved yet.</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[12px]`} onClick={() => setSelectedId(null)}>Cancel</button>
          <button
            type="button"
            className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px]`}
            onClick={() => {
              // The selected row came from the caller's current readable list.
              // Mint intent only after affirmative acknowledgement; the server
              // rechecks readability when a draft reaches its first send.
              const attachment: Attachment = {
                id: discussionContextId(selected.id),
                kind: 'discussion',
                label: title,
                discussionCaptureId: crypto.randomUUID(),
              }
              onAdd({ kind: 'discussion', attachment })
              setSelectedId(null)
            }}
          >
            {isDraft ? 'Add to draft' : 'Attach saved copy'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-1 pb-1" data-discussion-context-picker>
      {discussions.length === 0 ? (
        <p className="px-1 py-3 text-[12px] text-ink-soft">No readable discussions are available to attach.</p>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="Readable discussions">
          {discussions.map((discussion) => {
            const id = discussionContextId(discussion.id)
            const added = addedIds.includes(id)
            const title = discussionTitle(discussion.posts[0]?.body)
            return (
              <button
                key={discussion.id}
                type="button"
                disabled={added}
                onClick={() => setSelectedId(discussion.id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2 disabled:cursor-default disabled:opacity-65"
                aria-label={`${title}${added ? ', Added' : ''}`}
              >
                <MessageSquare size={15} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={title}>{title}</span>
                {added ? <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint"><Check size={13} />Added</span> : <span className="shrink-0 text-[11px] text-ink-faint">{discussion.posts.length} {discussion.posts.length === 1 ? 'post' : 'posts'}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
        <button type="button" onClick={() => invalidate(keys.myDiscussions)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink" aria-label="Refresh discussions">
          <RotateCw size={12} />Refresh
        </button>
        <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`}>Done</button>
      </div>
    </div>
  )
}
