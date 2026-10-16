/** Display-only catalog prose, loaded with the deferred picker or provider page;
 * the eager model-selection projection must not pull this into cold startup. */
import { formatTokens, type ModelInfo } from '../../contract/index.ts'

/** Familiar provider-declared effort labels get a caption; unknown ones do not. */
export const EFFORT_BLURBS: Record<string, string> = {
  Low: 'Quick replies, minimal reasoning.',
  Medium: 'Balanced speed and depth.',
  High: 'Deeper, step-by-step reasoning.',
  xHigh: 'Extended reasoning for hard, multi-file work.',
  Max: 'Maximum reasoning for the hardest problems.',
}

/** Every fragment needs provider-supplied metadata; absence stays unknown. */
export function modelBlurb(m: ModelInfo): string {
  const bits = [
    ...(m.blurb ? [m.blurb] : []),
    ...(m.contextWindow ? [`${formatTokens(m.contextWindow)} context`] : []),
    ...(m.capabilities?.thinking ? ['thinking'] : []),
    ...(m.pricing ? [`$${m.pricing.inputPerMTok}/M in · $${m.pricing.outputPerMTok}/M out`] : []),
    ...(m.deprecated ? ['deprecated'] : []),
  ]
  return bits.join(' · ') || 'No metadata from this provider.'
}
