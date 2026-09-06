/** Exact desired-state proof for a viewer-private discussion read cursor. */
import type { DiscussionReadState } from '../../contract/index.ts'

export function discussionReadRealized(
  state: DiscussionReadState,
  throughPostId: string,
): boolean {
  return state.throughPostId === throughPostId && state.read
}
