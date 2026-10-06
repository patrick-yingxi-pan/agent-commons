/** Execution posture for the contribution workflow's still-canned seams.
 * A configured conversation model or connector does not supply a reviewer,
 * delegated policy evaluator, or effect-envelope executor. Release profiles
 * therefore cannot borrow these deterministic development outcomes. */
import type { Contribution } from '../contract/index.ts'
import { realReviewVersion, type StoredContributionReview } from './contributionReviewState.ts'

export function contributionRuntimeMode(
  env: Record<string, string | undefined> = process.env,
): 'fixture' | 'unconfigured' {
  return env.DEPLOYMENT_PROFILE ? 'unconfigured' : 'fixture'
}

/** Old snapshots retain their timeline, but a fixture verdict is not current
 * execution authority in a release. Reuse this for the wire face and the gate. */
export function contributionReviewVersion(contribution: Pick<Contribution, 'reviewedVersion' | 'changeset'> & { reviewAttempts?: StoredContributionReview[] }): number | undefined {
  // A newer real attempt supersedes any earlier verdict, including a fixture.
  if (contribution.reviewAttempts?.some((run) => run.version === contribution.changeset?.at(-1)?.version)) {
    return realReviewVersion(contribution)
  }
  return contributionRuntimeMode() === 'fixture' ? contribution.reviewedVersion : undefined
}

export const CONTRIBUTION_RUNTIME_UNAVAILABLE = {
  review: 'Automated contribution review is not configured in this release. No review was run. Ask the project owner to review and land manually.',
  delegation: 'Delegated judgment is not configured in this release. No delegated decision was made. The project owner can act manually.',
  effect: 'Contribution effect execution is not configured in this release. No external effect was run.',
} as const
