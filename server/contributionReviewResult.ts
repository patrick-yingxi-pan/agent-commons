import type { ContributionReviewResult } from '../contract/contributionReview.ts'
import { MAX_REVIEW_FINDINGS, MAX_REVIEW_FINDING_CHARS, MAX_REVIEW_SUMMARY_CHARS } from '../contract/contributionReview.ts'

/** Fail-closed error for malformed or incomplete provider review responses. */
export class ContributionReviewGenerationError extends Error {
  constructor(message = 'The selected reviewer did not return a complete, valid review.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContributionReviewGenerationError'
  }
}

/** Provider I/O may have settled remotely even when this process saw no result. */
export class ContributionReviewTransportError extends Error {
  constructor(options?: ErrorOptions) {
    super('The selected reviewer could not be reached or its response timed out.', options)
    this.name = 'ContributionReviewTransportError'
  }
}

/** A settled response without trustworthy token accounting cannot be accepted. */
export class ContributionReviewUsageError extends Error {
  constructor() {
    super('The selected reviewer returned invalid usage accounting.')
    this.name = 'ContributionReviewUsageError'
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/** Parse only the bounded, exact JSON result accepted by the review contract. */
export function parseContributionReviewResult(text: string, entryIds: ReadonlySet<string>): ContributionReviewResult {
  if (text.length > 40_000) throw new ContributionReviewGenerationError('The selected reviewer returned an oversized review.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new ContributionReviewGenerationError(undefined, { cause })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContributionReviewGenerationError()
  const result = value as Record<string, unknown>
  if (!exactKeys(result, ['summary', 'findings'])) throw new ContributionReviewGenerationError()
  if (typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > MAX_REVIEW_SUMMARY_CHARS) {
    throw new ContributionReviewGenerationError()
  }
  if (!Array.isArray(result.findings) || result.findings.length > MAX_REVIEW_FINDINGS) throw new ContributionReviewGenerationError()

  const seen = new Set<string>()
  const findings = result.findings.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new ContributionReviewGenerationError()
    const finding = candidate as Record<string, unknown>
    if (!exactKeys(finding, ['entryId', 'body'])) throw new ContributionReviewGenerationError()
    if (typeof finding.entryId !== 'string' || !entryIds.has(finding.entryId) || seen.has(finding.entryId)) {
      throw new ContributionReviewGenerationError()
    }
    if (typeof finding.body !== 'string' || !finding.body.trim() || finding.body.length > MAX_REVIEW_FINDING_CHARS) {
      throw new ContributionReviewGenerationError()
    }
    seen.add(finding.entryId)
    return { entryId: finding.entryId, body: finding.body.trim() }
  })
  return { summary: result.summary.trim(), findings }
}
