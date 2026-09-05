/** Browser twin of the server's durable Contribution review-requirement receipt. */
export async function contributionReviewRequirementId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `contribution-require-review-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
