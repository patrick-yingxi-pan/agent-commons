/** The one share-tier cue (social S1, docs/design/social-layer.md §3.1): a compact
 *  pill naming the tier a grant carries. One ordered ramp for all four tiers so the
 *  cue can't drift between surfaces (grant rows today; proposal headers and byline
 *  chips later) — form follows function, one styled primitive. Kept in lib (the
 *  COPY_BUTTON_CLASS pattern) so the shared <TierBadge> and the lock test source
 *  the literal from one place; tests/social-ui.test.ts fails if a component
 *  re-hardcodes a tier label map. */
import type { ShareTier } from '../../contract/social.ts'

export const TIER_BADGE_CLASS =
  'inline-flex shrink-0 items-center rounded-full border border-line px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-soft'

/** The tier's human face — one map, ordered like SHARE_TIERS. */
export const TIER_LABELS: Record<ShareTier, string> = {
  view: 'View',
  comment: 'Comment',
  propose: 'Propose',
  'co-own': 'Co-own',
}
