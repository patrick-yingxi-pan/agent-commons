/** ── Live relative-time labels ─────────────────────────────────────────────
 *  One formatter for every "edited 4 hours ago" / "updated yesterday" stamp in
 *  the UI. The entities carry an absolute `*At` timestamp (epoch ms); the label
 *  is computed from the *current* time at render, so it actually advances —
 *  leave the app open an hour and "4 hours ago" becomes "5 hours ago", instead
 *  of a frozen seed string that's wrong by tomorrow.
 *
 *  Pure (time in, string out), so the Node test harness can lock every bucket
 *  with fixed (then, now) pairs — `nowMs` is a parameter, not an ambient read. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** A "time ago" label from an absolute epoch-ms timestamp. Coarsens as it ages:
 *  just now → N minutes → N hours → yesterday → N days → an absolute date (with
 *  the year once it's a different calendar year). A future timestamp (clock skew,
 *  an optimistic stamp racing the server) reads as "just now" rather than a
 *  negative age. */
export function relativeTime(thenMs: number, nowMs: number = Date.now()): string {
  // A missing / non-finite stamp (e.g. a record persisted under an older schema,
  // before this field existed) gets an honest fallback rather than "undefined NaN".
  if (!Number.isFinite(thenMs)) return 'recently'
  const diff = nowMs - thenMs
  if (diff < 45 * SEC) return 'just now'
  if (diff < 45 * MIN) {
    const m = Math.max(1, Math.round(diff / MIN))
    return m === 1 ? '1 minute ago' : `${m} minutes ago`
  }
  if (diff < 90 * MIN) return '1 hour ago'
  if (diff < 22 * HOUR) return `${Math.round(diff / HOUR)} hours ago`
  if (diff < 36 * HOUR) return 'yesterday'
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)} days ago`

  const d = new Date(thenMs)
  const sameYear = new Date(nowMs).getFullYear() === d.getFullYear()
  return sameYear
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
