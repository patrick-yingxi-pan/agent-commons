/** Addressed cache merge for the viewer's Commons endorsement membership. */
import type { CommonsItem } from '../../contract/index.ts'

/** The acknowledgement proves only this viewer's desired membership. Public
 * count ordering belongs to a fresh projection read because other viewers may
 * like or unlike the same item while this response is in flight. */
export function mergeCommonsLikeMembership(
  current: CommonsItem[],
  itemId: string,
  liked: boolean,
): CommonsItem[] {
  let changed = false
  const next = current.map((item) => {
    if (item.id !== itemId || (item.liked === true) === liked) return item
    changed = true
    const { liked: _liked, ...rest } = item
    return liked ? { ...rest, liked: true } : rest
  })
  return changed ? next : current
}
