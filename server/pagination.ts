/** ── Cursor pagination (design F3 PD14) ─────────────────────────────────────
 *  A reusable, **keyed** cursor pager for list endpoints. The cursor anchors to the
 *  stable id of the last item returned (not a numeric offset), so items appended
 *  between page fetches don't shift the window — a scan never skips or duplicates an
 *  item it has already seen (the property offset pagination lacks). Opt-in: an
 *  endpoint paginates only when the request carries `?limit`; otherwise it returns
 *  the full array (back-compat — see contract `Page<T>`).
 *
 *  The cursor is base64 of the anchor key — opaque to clients, decoded only here.
 *
 *  Scale note: `paginate` locates the anchor with an O(n) `findIndex`, so walking a
 *  large list is O(n²). That's fine for the mock's in-memory lists; a production store
 *  resolves the cursor with an indexed range query (`WHERE id < :anchor ... LIMIT n`),
 *  which the keyed-cursor shape maps onto directly. */
import type { Page } from '../contract/index.ts'

/** Largest page a client may request. */
export const MAX_PAGE_LIMIT = 100

/** Parse the pagination query for a list endpoint:
 *   • `null`      — no `limit` param ⇒ the caller returns the full array (back-compat),
 *   • `'invalid'` — a malformed `limit` ⇒ the caller replies 400,
 *   • `{limit, cursor?}` — paginate.
 *  `limit` must be an integer in `1..MAX_PAGE_LIMIT`. */
export function pageParams(url: URL): { limit: number; cursor?: string } | null | 'invalid' {
  const raw = url.searchParams.get('limit')
  if (raw === null) return null
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) return 'invalid'
  const cursor = url.searchParams.get('cursor') ?? undefined
  return cursor ? { limit, cursor } : { limit }
}

function encodeCursor(key: string): string {
  return btoa(key)
}
function decodeCursor(cursor: string): string | null {
  try {
    return atob(cursor)
  } catch {
    return null
  }
}

/** Return one page of `items` (already in the desired, stable order) starting after
 *  the cursor's anchor. `keyOf` yields each item's stable unique key (its id). A
 *  cursor that doesn't decode, or whose anchor is no longer present, restarts from the
 *  top (lenient — a client only ever replays a cursor we issued). */
export function paginate<T>(
  items: T[],
  keyOf: (item: T) => string,
  params: { limit: number; cursor?: string },
): Page<T> {
  let start = 0
  if (params.cursor) {
    const anchor = decodeCursor(params.cursor)
    if (anchor !== null) {
      const idx = items.findIndex((item) => keyOf(item) === anchor)
      if (idx >= 0) start = idx + 1
    }
  }
  const pageItems = items.slice(start, start + params.limit)
  const consumed = start + pageItems.length
  const nextCursor =
    consumed < items.length && pageItems.length > 0
      ? encodeCursor(keyOf(pageItems[pageItems.length - 1]))
      : null
  return { items: pageItems, nextCursor }
}
