/** Addressed cache merges for the viewer's Follow and Watch relationships. */
import type { CommonsItem, SocialEntityRef } from '../../contract/index.ts'

const sameSubject = (left: SocialEntityRef, right: SocialEntityRef): boolean =>
  left.kind === right.kind && left.id === right.id

/** Follow is actor-relative in the Commons. Change only that viewer stamp;
 * never replace a card whose counts, discussion, or embed may have advanced. */
export function mergeCommonsFollow(
  current: CommonsItem[],
  name: string,
  following: boolean,
): CommonsItem[] {
  let changed = false
  const next = current.map((item) => {
    if (item.actor !== name || (item.followed === true) === following) return item
    changed = true
    const { followed: _followed, ...rest } = item
    return following ? { ...rest, followed: true } : rest
  })
  return changed ? next : current
}

/** Watch is subject-relative in the Commons. One acknowledgement may update
 * several cards for the same subject, but no unrelated card field. */
export function mergeCommonsWatch(
  current: CommonsItem[],
  subject: SocialEntityRef,
  watching: boolean,
): CommonsItem[] {
  let changed = false
  const next = current.map((item) => {
    if (!sameSubject(item.subject, subject) || (item.watched === true) === watching) return item
    changed = true
    const { watched: _watched, ...rest } = item
    return watching ? { ...rest, watched: true } : rest
  })
  return changed ? next : current
}
