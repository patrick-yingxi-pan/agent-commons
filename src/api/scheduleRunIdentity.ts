/** Browser-side projection of the server's opaque manual-run identity. The
 * retained logical key is never exposed as the run id itself. */
export async function manualScheduleRunId(idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `run-manual-${hex.slice(0, 24)}`
}
