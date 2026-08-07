/** ── The offer form's pure logic (social S3) ─────────────────────────────────
 *  What a proposal offer FORM's raw inputs mean, as dependency-free functions —
 *  the `railPanes.ts` pattern: pure math out of the component so `node --test`
 *  can exercise it without a DOM.
 *
 *  The governing rule: a form must never be able to offer what the server would
 *  refuse. Each kind's inputs are therefore validated by the very predicate the
 *  server validates with — `PROPOSABLE_SCHEDULE_FIELDS` for a routine,
 *  `docBlockText` for an artifact body — and each `…Delta` builder mirrors the
 *  store's refusals exactly, returning null so the Offer button stays disabled
 *  rather than posting something the wall rejects. */
import {
  docBlockText,
  type ArtifactContent,
  type ProposableScheduleField,
  type ProposalDelta,
} from '../../contract/index.ts'

/** Boolean fields render as a two-option select rather than a text box. */
export const BOOLEAN_SCHEDULE_FIELDS = new Set<ProposableScheduleField>(['enabled', 'notifyOnFailure'])

/** An empty or whitespace value yields NO delta, so the form can't post
 *  something the server's `isSchedulePatch` would refuse. */
export function schedulePatchDelta(field: ProposableScheduleField, value: string): ProposalDelta | null {
  if (BOOLEAN_SCHEDULE_FIELDS.has(field)) return { kind: 'schedule-patch', patch: { [field]: value === 'true' } }
  return value.trim() ? { kind: 'schedule-patch', patch: { [field]: value.trim() } } : null
}

/** The blocks an artifact body offers for patching — each one's index and its
 *  current text — filtered by `docBlockText`, the same total function the
 *  server's validator uses. ONE predicate, both sides of the wire: the form
 *  cannot list a block the offer route would then refuse, and the owner's
 *  in-place pencil appears in exactly the same places. */
export function patchableBlocks(body: ArtifactContent | undefined): { index: number; text: string }[] {
  if (!body || body.type !== 'doc') return []
  const out: { index: number; text: string }[] = []
  body.blocks.forEach((b, index) => {
    const text = docBlockText(b)
    if (text !== undefined) out.push({ index, text })
  })
  return out
}

/** Mirrors the server's refusals: no block chosen, empty text, or text
 *  IDENTICAL to what the block already says (a no-op that would still consume
 *  an L#) all yield no delta. */
export function artifactPatchDelta(block: number | null, text: string, base: string | undefined): ProposalDelta | null {
  if (block === null) return null
  const next = text.trim()
  if (!next || next === base) return null
  return { kind: 'artifact-patch', block, text: next }
}

/** WHICH offer form a subject gets. Per-kind because a delta is per-kind — and
 *  an artifact whose body has no addressable prose (an image, a sheet, a deck, a
 *  served file) falls through to the FLOOR rather than to a block picker with
 *  nothing in it: the server accepts a `suggestion` against any subject, so
 *  showing a form that can never submit would be a dead affordance repeated on
 *  every non-doc artifact. */
export function offerFormFor(
  subjectKind: string,
  patchableBlockCount: number,
): 'schedule-fields' | 'artifact-blocks' | 'suggestion' {
  if (subjectKind === 'schedule') return 'schedule-fields'
  if (subjectKind === 'artifact' && patchableBlockCount > 0) return 'artifact-blocks'
  return 'suggestion'
}

/** The reviewable-suggestion floor every subject kind supports. */
export function suggestionDelta(text: string): ProposalDelta | null {
  return text.trim() ? { kind: 'suggestion', text: text.trim() } : null
}
