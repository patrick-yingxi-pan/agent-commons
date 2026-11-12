/** Every per-post icon control wears one compact face, on the byline or fold gutter.
 * Shape only: callers own color, hover, and reveal state so the endorsement's
 * accent cannot lose to a resting color by CSS cascade order. Keep width
 * flexible for the endorsement count and preserve the caller's destructive gap. */
export const POST_ACT_CLASS =
  'flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 transition focus-visible:opacity-100'
