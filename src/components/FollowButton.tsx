import { UserCheck, UserPlus } from 'lucide-react'
import { useMe } from '../api'
import {
  enqueueStandingRelationship,
  followRelationshipResourceId,
  heldFollowRelationship,
  useStandingRelationshipStatus,
} from '../controller/standingRelationshipMutations.ts'

/** The ONE follow toggle (S7). Every surface that offers "follow this
 *  workspace" wears this, for the reason `TierBadge` and `WatchToggle` exist:
 *  one styled primitive per role, so the cue can't drift between copy-pasted
 *  copies (form follows function; locked by src/lib/social-ui.test.ts).
 *
 *  Deliberately the same anatomy as `WatchToggle` — the two are siblings: watch
 *  is a standing relationship with a RESOURCE, follow with a PERSON. They read
 *  as one system because they are one idea applied to the layer's two kinds of
 *  subject. What differs is only the glyph and the sentence, because what they
 *  deliver differs: a watch rings your bell, a follow fills your Commons lens.
 *
 *  Renders from the SERVER's `youFollow` alone — never from a local optimistic
 *  guess — so the control and the wall can't disagree (the SOCIAL-4b lesson). */
export function FollowButton({ name, following, ready = true }: {
  /** The target workspace's public display name — its handle everywhere else. */
  name: string
  following: boolean
  /** False while the host is still fetching the profile: the button waits
   *  rather than rendering "Follow" over an unknown truth. */
  ready?: boolean
}) {
  const me = useMe().data
  const mutation = useStandingRelationshipStatus()
  const held = heldFollowRelationship(name)
  const active = mutation.activeResourceId === followRelationshipResourceId(name)
  const waiting = active && mutation.error !== null
  const label = held
    ? !active
      ? held.following ? 'Follow queued' : 'Unfollow queued'
      : waiting
        ? 'Waiting for Retry'
        : held.following ? 'Following…' : 'Unfollowing…'
    : following ? 'Following' : 'Follow'
  const toggle = () => {
    if (held || !ready || !me) return
    void enqueueStandingRelationship({
      tenantId: me.tenant.id,
      kind: 'follow',
      name,
      following: !following,
    })
  }
  return (
    <button
      onClick={toggle}
      disabled={!!held || !ready || !me}
      aria-busy={(active && !waiting) || undefined}
      aria-pressed={following}
      title={
        waiting ? 'Use Retry or Dismiss in the recovery banner'
        : held ? label
        : following ? `Stop following ${name} — their posts leave your Following lens`
        : `Follow ${name} — what they publish collects in your Following lens`
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition disabled:opacity-45 ${
        following
          ? 'border-accent/40 bg-accent-tint text-accent-strong'
          : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
      }`}
    >
      {following ? <UserCheck size={14} /> : <UserPlus size={14} />} {label}
    </button>
  )
}
