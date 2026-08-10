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
 *  a position (a relation edge — no page draws one) resolves to no focus target
 *  and the caller still doors to the entity. The rule is the notification
 *  door's: always somewhere, never a no-op. */
import type { AnchorLocus, SocialAnchor, SocialEntityKind } from '../../contract/index.ts'
import type { SectionId } from '../types'
import type { FocusTarget } from './notificationDoor'

/** Which rail SECTION opens a social noun's page — the ONE answer, because two
 *  surfaces ask it (the Commons feed card and the `AnchorChip`) and they were
 *  asking it with two hand-copied ternaries. That is how `artifact` came to be
 *  missing from both: an artifact has a canonical viewer at `/artifacts/:id`,
 *  but neither copy listed it, so a thread anchored to an artifact rendered its
 *  own subject as dead text.
 *
 *  `null` means "no section page of its own": a SESSION is a pane fill, not a
 *  section (its caller opens the conversation), and the remaining nouns are
 *  reached through their subject rather than a list of their own. */
export function sectionForSocialKind(kind: SocialEntityKind): SectionId | null {
  switch (kind) {
    case 'project':
      return 'projects'
    case 'schedule':
      return 'scheduled'
    case 'context':
      return 'contexts'
    case 'discussion':
      return 'discussions'
    case 'artifact':
      return 'artifacts'
    // A session opens as a conversation, not a section page; a proposal and a
    // principal are reached through their subject and their profile door.
    case 'session':
    case 'proposal':
    case 'principal':
      return null
    default:
      return assertNever(kind, null)
  }
}

/** The position in words — the chip's suffix ("· turn in this conversation").
 *  Kept short and lowercase: it reads as a continuation of the entity label. */
export function describeLocus(locus: AnchorLocus): string {
  switch (locus.kind) {
    case 'session-turn':
      return 'one turn'
    case 'artifact-block':
      return 'one block'
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
    // An artifact's viewer renders its body one BLOCK at a time, each an
    // addressable element — the address `artifact-patch` already edits by, so a
    // thread and a patch land on the same thing.
    case 'artifact-block':
      return { artifactBlock: locus.block }
    // Declared, not yet focusable: a relation EDGE has no surface of its own at
    // all — no page renders one edge as an element to land on. It becomes a
    // target when the graph grows a surface that draws its edges; until then the
    // chip names it and doors to the entity (always somewhere, never a no-op).
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
