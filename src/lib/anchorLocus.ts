/** ── Anchor loci — the per-kind resolvers (social S2, SOCIAL-6b) ─────────────
 *  A discussion anchors to an entity and, optionally, to a POSITION inside it:
 *  a turn in a conversation, a range of an artifact, one run of a schedule, one
 *  edge of the graph (`AnchorLocus`, declared in the contract since S0). This is
 *  the ONE place a locus becomes UI — its human phrase and where clicking it
 *  lands — so the chip on a discussion page, the chip in the rail, and any
 *  future gutter can't drift apart in what a position is called or where it
 *  goes (the *Registries have one home* rule, src/CLAUDE.md).
 *
 *  Both functions are TOTAL over the union: a new `AnchorLocus` variant leaves
 *  the argument wider than `never` in the default arm and fails the build,
 *  forcing its phrase AND its landing to be decided in one edit — the
 *  exhaustiveness idiom `notificationDoor.ts` uses for bells.
 *
 *  Resolution DEGRADES, never dead-ends: a locus whose surface can't yet focus
 *  a position (an artifact range — the viewer renders no line gutter) resolves
 *  to no focus target and the caller still doors to the entity. The rule is the
 *  notification door's: always somewhere, never a no-op. */
import type { AnchorLocus, SocialAnchor } from '../../contract/index.ts'
import type { FocusTarget } from './notificationDoor'

/** The position in words — the chip's suffix ("· turn in this conversation").
 *  Kept short and lowercase: it reads as a continuation of the entity label. */
export function describeLocus(locus: AnchorLocus): string {
  switch (locus.kind) {
    case 'session-turn':
      return 'one turn'
    case 'artifact-range':
      // A one-line range reads as a line, not a range — the plural is a lie at n=1.
      return locus.from === locus.to ? `line ${locus.from}` : `lines ${locus.from}–${locus.to}`
    case 'schedule-run':
      return 'one run'
    case 'relation-edge':
      return 'one link'
    default:
      return assertNever(locus, 'one position')
  }
}

/** The transient highlight a locus resolves to on arrival — consumed once by
 *  the element that matches it (`useFocusFlash`), exactly like a notification
 *  door's target. `null` means "this position has no focusable surface yet":
 *  the caller doors to the entity and the position stays descriptive. */
export function locusFocus(anchor: SocialAnchor): FocusTarget | null {
  const locus = anchor.locus
  if (!locus) return null
  switch (locus.kind) {
    // The conversation is the surface that hosts positions today: every turn
    // renders as an addressable row (`MessageRow`), so the thread's chip lands
    // on the exact turn and flashes it.
    case 'session-turn':
      return { messageId: locus.messageId }
    // A routine's page lists its runs, each an addressable row.
    case 'schedule-run':
      return { runId: locus.runId }
    // Declared, not yet focusable. `artifact-range` means LINES, but this
    // prototype's artifact bodies are structured rather than linear (doc blocks
    // / sheet rows / slides), so there is no line to land on until an artifact
    // grows a line-oriented body — see the design ledger. A relation edge has no
    // surface of its own at all. Each becomes a target when its surface grows
    // the position; until then the chip names it and doors to the entity.
    case 'artifact-range':
    case 'relation-edge':
      return null
    default:
      return assertNever(locus, null)
  }
}

/** Compile-time exhaustiveness: a new `AnchorLocus` variant with no `case`
 *  above leaves the argument wider than `never` and fails the build. At runtime
 *  (a persisted row of some unknown future kind) it degrades to the caller's
 *  fallback rather than throwing — the same contract the notification doors
 *  keep: a stale row is a vague label, never a crash. */
function assertNever<T>(locus: never, fallback: T): T {
  void locus
  return fallback
}
