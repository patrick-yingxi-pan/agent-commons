/** Transport and exact authoritative recovery for Follow and Watch. */
import type {
  CommonsItem,
  SetFollowRequest,
  SetSocialWatchRequest,
  SetWatchRequest,
  SocialEntityRef,
  WatchState,
} from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidatePrefix, mutate, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeCommonsFollow, mergeCommonsWatch } from './standingRelationshipRevision.ts'

export type StandingRelationshipIntent = {
  tenantId: string
  intentId: string
} & (
  | { kind: 'follow'; name: string; following: boolean }
  | { kind: 'watch'; subject: SocialEntityRef; watching: boolean }
)

export const followRelationshipResourceId = (name: string): string => `follow:${name}`
export const watchRelationshipResourceId = (subject: SocialEntityRef): string =>
  `watch:${subject.kind}:${subject.id}`

export const standingRelationshipResourceId = (intent: StandingRelationshipIntent): string =>
  intent.kind === 'follow'
    ? followRelationshipResourceId(intent.name)
    : watchRelationshipResourceId(intent.subject)

const followRealized = (list: string[], intent: Extract<StandingRelationshipIntent, { kind: 'follow' }>) =>
  list.includes(intent.name) === intent.following

function rememberFollow(
  list: string[],
  intent: Extract<StandingRelationshipIntent, { kind: 'follow' }>,
): void {
  setData(keys.follows, list)
  mutate<CommonsItem[]>(keys.commons, (current) =>
    current
      ? mergeCommonsFollow(current, intent.name, intent.following)
      : current as unknown as CommonsItem[],
  )
  // Counts and follower rosters are composed projections, so re-read every
  // profile already in view rather than trying to reconstruct them here.
  invalidatePrefix(keys.ownerProfile())
}

function rememberWatch(
  state: WatchState,
  intent: Extract<StandingRelationshipIntent, { kind: 'watch' }>,
): void {
  if (intent.subject.kind === 'project') setData(keys.projectWatch(intent.subject.id), state)
  mutate<CommonsItem[]>(keys.commons, (current) =>
    current
      ? mergeCommonsWatch(current, intent.subject, state.watching)
      : current as unknown as CommonsItem[],
  )
}

export async function applyStandingRelationship(
  intent: StandingRelationshipIntent,
  idempotencyKey: string,
): Promise<void> {
  if (intent.kind === 'follow') {
    const list = await apiPost<string[]>(
      paths.socialFollow(),
      { name: intent.name, following: intent.following } satisfies SetFollowRequest,
      { idempotencyKey },
    )
    if (!followRealized(list, intent)) {
      throw new Error('The server did not acknowledge the requested Follow state.')
    }
    rememberFollow(list, intent)
    return
  }

  const state = intent.subject.kind === 'project'
    ? await apiPost<WatchState>(
        paths.projectWatch(intent.subject.id),
        { watching: intent.watching } satisfies SetWatchRequest,
        { idempotencyKey },
      )
    : await apiPost<WatchState>(
        paths.socialWatch(),
        { subject: intent.subject, watching: intent.watching } satisfies SetSocialWatchRequest,
        { idempotencyKey },
      )
  if (state.watching !== intent.watching) {
    throw new Error('The server did not acknowledge the requested Watch state.')
  }
  rememberWatch(state, intent)
}

/** Read the relationship itself after uncertainty. Explicit desired state makes
 * represented equality sufficient proof without inventing a revision. */
export async function reconcileStandingRelationship(
  intent: StandingRelationshipIntent,
): Promise<boolean> {
  if (intent.kind === 'follow') {
    const list = await apiGet<string[]>(paths.follows())
    rememberFollow(list, intent)
    return followRealized(list, intent)
  }

  const state = await apiGet<WatchState>(
    intent.subject.kind === 'project'
      ? paths.projectWatch(intent.subject.id)
      : paths.socialWatchState(intent.subject.kind, intent.subject.id),
  )
  rememberWatch(state, intent)
  return state.watching === intent.watching
}
