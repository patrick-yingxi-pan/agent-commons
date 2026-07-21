import type { ShareTier } from '../../contract/social.ts'
import { TIER_BADGE_CLASS, TIER_LABELS } from '../lib/tierBadge'

/** The one share-tier badge (social S1). Every surface that names a grant's tier
 *  wears this — the pill and the label map live in `src/lib/tierBadge.ts` so the
 *  cue can't drift between copy-pasted copies (form follows function; locked by
 *  tests/social-ui.test.ts). */
export function TierBadge({ tier }: { tier: ShareTier }) {
  return <span className={TIER_BADGE_CLASS}>{TIER_LABELS[tier]}</span>
}
