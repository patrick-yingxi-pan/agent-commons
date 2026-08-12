import { useState } from 'react'
import { UserCheck, UserPlus } from 'lucide-react'
import { setFollow } from '../api'

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
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    if (busy || !ready) return
    setBusy(true)
    setFailed(false)
    try {
      await setFollow(name, !following)
    } catch {
      // The button renders purely from server state, so a swallowed failure
      // would leave it visually unchanged with no signal — flag it instead.
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy || !ready}
      aria-pressed={following}
      title={
        failed ? 'Couldn’t update — click to retry'
        : following ? `Stop following ${name} — their posts leave your Following lens`
        : `Follow ${name} — what they publish collects in your Following lens`
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition disabled:opacity-45 ${
        following
          ? 'border-accent/40 bg-accent-tint text-accent-strong'
          : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
      }`}
    >
      {following ? <UserCheck size={14} /> : <UserPlus size={14} />} {following ? 'Following' : 'Follow'}
    </button>
  )
}
