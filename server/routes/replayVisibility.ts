import type { RelationGraph, SocialEntityRef } from '../../contract/index.ts'
import type { Ctx } from '../http/respond.ts'
import type { CachedResponse } from '../idempotency.ts'
import { store } from '../store/index.ts'

/** A retained success is an acknowledgement, never enduring read authority.
 * These route-owned guards inspect its original subject, not a changed Retry
 * body. They refuse disclosure without re-executing the historical mutation. */
export type ReplayVisibility = (ctx: Ctx, response: CachedResponse) => boolean

export const artifactReplayVisible: ReplayVisibility = ({ req, params }) => {
  const artifact = store.artifactById(params.id)
  return artifact !== undefined && store.artifactOwnedBy(artifact, store.identity(req.headers).tenant.id)
}

export const discussionReplayVisible: ReplayVisibility = ({ req, params }, response) => {
  const body = JSON.parse(response.body)
  // Removing the last post retires the Discussion itself. Its actor/target-
  // scoped null acknowledgement contains no subject or content to reauthorize.
  if (req.method === 'DELETE' && body.ok === true && body.discussion === null) return true
  const id: string = params.did ?? body.id
  return store.getDiscussion(id, store.identity(req.headers).tenant.id) !== undefined
}

export const proposalReplayVisible: ReplayVisibility = ({ req, params }) =>
  store.getSocialProposal(params.pid, store.identity(req.headers).tenant.id) !== undefined

export const grantReplayVisible: ReplayVisibility = ({ req }, response) => {
  const { subject } = JSON.parse(response.body) as { subject: SocialEntityRef }
  return store.grantSubjectVisible(subject, store.identity(req.headers).tenant.id)
}

/** Relation and Project creation responses contain the whole owner graph.
 * One retained artifact must not be redisclosed through an unrelated old ack.
 * Absence of a graph/retained row doesn't change historical replay semantics. */
export const graphReplayVisible: ReplayVisibility = ({ req }, response) => {
  const body = JSON.parse(response.body) as RelationGraph | { graph: RelationGraph }
  const graph = 'graph' in body ? body.graph : body
  const hidden = new Set(store.listTrashedArtifacts(store.identity(req.headers).tenant.id).map((row) => row.artifact.id))
  for (const id of [...Object.keys(graph.artifactProject), ...Object.keys(graph.artifactSource), ...graph.extraArtifacts.map((row) => row.id)]) {
    if (store.artifactIsRetired(id)) hidden.add(id)
  }
  return !graph.extraArtifacts.some((artifact) => hidden.has(artifact.id)) &&
    !Object.keys(graph.artifactProject).some((id) => hidden.has(id)) &&
    !Object.keys(graph.artifactSource).some((id) => hidden.has(id))
}
