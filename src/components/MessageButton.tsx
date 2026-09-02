/** ── Message this workspace (social S7 on the profile surface) ───────────────
 *  The door that starts — or resumes — a direct message with a person.
 *
 *  A DM is a Discussion anchored to a PRINCIPAL, and the server get-or-creates
 *  it over the unordered PAIR, so there is exactly one conversation with anyone
 *  and this button has exactly two states:
 *
 *    already talking  → a DOOR into the existing thread's page;
 *    not yet          → a popover holding the ONE `AnchorThreadComposer`, whose
 *                       first post creates the thread and opens it.
 *
 *  WHICH of those it is comes from the server (`OwnerFollowFace.dmId`), not from
 *  this component scanning its inbox for a matching `counterpart` — display
 *  names are neither unique nor identities, and the pair is the server's fact
 *  (the review that earned the widened name-comparison lock).
 *
 *  The composer is the shared one on purpose (`src/components/thread-composer.test.ts`
 *  admits exactly one caller of `openDiscussion`): a DM's first message must
 *  behave like every other first post — same field, same Post verb, same
 *  get-or-create race safety — because it IS one.
 *
 *  Chrome + popover rather than a pane, for the `SessionShareButton` reason
 *  (UI-15): opening a channel is a transient act, and the conversation it
 *  produces has a page of its own to land on. */
import { useState } from 'react'
import { Mail } from 'lucide-react'
import type { Discussion } from '../../contract/index.ts'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { useDismissable } from '../lib/useDismissable'
import { AnchorThreadComposer } from './AnchorThreadComposer'

export function MessageButton({ name, dmId, onOpenDiscussion }: {
  /** The target workspace's public display name — a principal ref's id. */
  name: string
  /** The pair's existing thread, when the server says there is one. */
  dmId?: string
  onOpenDiscussion: (discussionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [held, setHeld] = useState(false)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => { if (!held) setOpen(false) })
  const panelRef = usePopoverShift<HTMLDivElement>(open)

  const CHROME =
    'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[13px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink'

  if (dmId) {
    return (
      <button onClick={() => onOpenDiscussion(dmId)} title={`Open your conversation with ${name}`} className={CHROME}>
        <Mail size={14} /> Message
      </button>
    )
  }
  const landed = (thread: Discussion) => {
    setOpen(false)
    onOpenDiscussion(thread.id)
  }
  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => { if (!held) setOpen((v) => !v) }}
        disabled={held}
        aria-expanded={open}
        title={held ? 'Wait for this message to be confirmed' : `Send ${name} a direct message`}
        className={`${CHROME} disabled:opacity-50`}
      >
        <Mail size={14} /> Message
      </button>
      {open && (
        <div ref={panelRef} className={`${POPOVER_SURFACE} absolute right-0 top-10 z-40 w-80 p-3`}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Message {name}</p>
          <AnchorThreadComposer
            subject={{ kind: 'principal', id: name }}
            thread={null}
            placeholder={`Write to ${name}…`}
            ariaLabel={`Send ${name} a direct message`}
            autoFocus
            onPosted={landed}
            onCancel={() => { if (!held) setOpen(false) }}
            onHeldChange={setHeld}
          />
        </div>
      )}
    </div>
  )
}
