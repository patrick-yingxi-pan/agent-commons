/** ── Share this conversation (social S1 on the session surface) ──────────────
 *  The share door a CONVERSATION wears. Every other social noun configures its
 *  audience on an entity page's owner rail; a conversation has no page and no
 *  rail — it is the surface — so the door is CHROME on its title bar and the
 *  roster opens in a popover (UI-15: chrome, never a pane; and a modal is only
 *  for a transient act — configuring an audience is exactly that).
 *
 *  What opens is the SAME `GrantsPanel` the project page's rail hosts, unchanged
 *  and generic over the subject ref (the GrantsPanel rule) — so a conversation's
 *  tiers, link grants, publish-note semantics, and revoke behave identically to
 *  every other subject's by construction, not by a parallel implementation.
 *
 *  Owner-gated on the projection's viewer-relative `own` (contract/entities.ts):
 *  a social grant widens READS without widening ownership, so a granted visitor
 *  opens the conversation and never sees who else it is shared with. */
import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { useDismissable } from '../lib/useDismissable'
import { GrantsPanel } from './GrantsPanel'

export function SessionShareButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false)
  // The wrapper holds both trigger and panel, so it is what counts as "inside".
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  // UI-1: wearing POPOVER_SURFACE is only half the funnel — the surface carries
  // the width clamp, the HOOK does the containment (and stamps `data-popover`,
  // the sweep's enumeration handle). Right-anchoring alone put the panel's left
  // edge at x=0 on a 320px viewport; found by the /ui-review sweep.
  const panelRef = usePopoverShift<HTMLDivElement>(open)
  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Share this conversation"
        title="Share this conversation"
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
      >
        <Share2 size={15} />
      </button>
      {open && (
        // Right-anchored: the bar's trailing cluster sits at the surface's edge,
        // so a left-anchored panel would hang off it. The viewport width clamp
        // is POPOVER_SURFACE's — never re-declared here (the module owns that
        // literal, and a second one would contradict it).
        <div ref={panelRef} className={`${POPOVER_SURFACE} absolute right-0 top-9 z-40 w-80 p-3`}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Share this conversation</p>
          <GrantsPanel subject={{ kind: 'session', id: sessionId }} />
        </div>
      )}
    </div>
  )
}
