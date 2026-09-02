/** Pure identity and desired-state algebra for acknowledgement-owned prose. */
import type {
  AnchorLocus,
  Discussion,
  SocialEntityRef,
} from '../../contract/index.ts'

interface SocialPostIntentBase {
  tenantId: string
  logicalKey: string
  body: string
}

export type SocialPostMutationIntent =
  | (SocialPostIntentBase & {
      kind: 'open'
      subject: SocialEntityRef
      locus?: AnchorLocus
    })
  | (SocialPostIntentBase & {
      kind: 'append'
      subject: SocialEntityRef
      locus?: AnchorLocus
      discussionId: string
      replyTo?: string
    })
  | (SocialPostIntentBase & {
      kind: 'wall'
      authorName: string
    })

const locusKey = (locus: AnchorLocus | undefined): string =>
  locus === undefined
    ? 'root'
    : Object.entries(locus)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}:${String(value)}`)
        .join('|')

/** Every projection of one anchored thread shares a hold, including a composer
 *  that learns the thread id only after its first post lands. */
export function socialPostAnchorResourceId(
  subject: SocialEntityRef,
  locus?: AnchorLocus,
): string {
  return `${subject.kind}:${subject.id}:${locusKey(locus)}`
}

export function socialPostResourceId(intent: SocialPostMutationIntent): string {
  if (intent.kind === 'wall') return `principal:${intent.authorName}:wall`
  return socialPostAnchorResourceId(intent.subject, intent.locus)
}

export function discussionWithPost(
  discussions: readonly Discussion[],
  postId: string,
): Discussion | undefined {
  return discussions.find((discussion) => discussion.posts.some((post) => post.id === postId))
}
