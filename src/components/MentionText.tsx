/** ── @-mentions, rendered (social S8) ────────────────────────────────────────
 *  A body with its `@Name` spans turned into doors onto those people's profiles.
 *
 *  The names come from the SERVER (`DiscussionPost.mentions`) and are never
 *  re-derived here. Two reasons, and both matter:
 *
 *  1. **A display name has no self-delimiting syntax.** Names in this product
 *     carry spaces and punctuation ("Acme, Inc."), so "where does the mention
 *     end" is a question only the registry of real names can answer. A client
 *     regex would either stop at the first space (linkifying "@Acme" out of
 *     "@Acme, Inc.") or run past the name into the sentence.
 *  2. **The same resolution decided who was RUNG.** If this component parsed
 *     independently it could highlight a name that got no bell, or miss one that
 *     did — the affordance and the act drifting apart, which is the defect the
 *     capability face (SOCIAL-4b) was earned for, in miniature.
 *
 *  So the server hands over exactly the names it resolved, and the only work
 *  here is locating those literal strings after their `@`. Absent = a plain
 *  body, which is the common case and costs nothing. */
import { Fragment } from 'react'
import { DOOR_CLASS } from '../lib/textDoor'
import { mentionSegments } from '../lib/mentions'

export function MentionText({
  body,
  mentions,
  onOpen,
}: {
  body: string
  mentions?: string[]
  /** Open a mentioned person's profile. Absent = render the mention as plain
   *  emphasis (a surface with no navigation of its own, e.g. a preview). */
  onOpen?: (name: string) => void
}) {
  const segments = mentionSegments(body, mentions)
  return (
    <>
      {segments.map((seg, i) =>
        seg.mention && onOpen ? (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation()
              onOpen(seg.mention!)
            }}
            className={`font-medium text-co-strong ${DOOR_CLASS}`}
          >
            {seg.text}
          </button>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  )
}
