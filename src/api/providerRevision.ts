import type { ModelProvider } from '../../contract/index.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

/** Merge only the human-authored provider definition. Connection/catalog and
 * transient relay/default projections have independent owners and must survive
 * a delayed definition acknowledgement. */
export function mergeProviderDefinition(current: ModelProvider, incoming: ModelProvider): ModelProvider {
  if (!shouldAcceptEntityRevision(current.definitionRevision, incoming.definitionRevision)) return current
  const next: ModelProvider = {
    ...current,
    label: incoming.label,
    modelFamily: incoming.modelFamily,
    effortLevels: incoming.effortLevels,
    definitionRevision: incoming.definitionRevision,
  }
  if (incoming.plan === undefined) delete next.plan
  else next.plan = incoming.plan
  if (incoming.authority === undefined) delete next.authority
  else next.authority = incoming.authority
  return next
}

/** Merge only the endpoint connection/catalog projection. Definition, default
 * selection, identity, and live Session-relay state stay on the cache's row. */
export function mergeProviderConnection(current: ModelProvider, incoming: ModelProvider): ModelProvider {
  if (!shouldAcceptEntityRevision(current.connectionRevision, incoming.connectionRevision)) return current
  const next: ModelProvider = {
    ...current,
    connectionRevision: incoming.connectionRevision,
  }
  if (incoming.models === undefined) delete next.models
  else next.models = incoming.models
  if (incoming.catalogSource === undefined) delete next.catalogSource
  else next.catalogSource = incoming.catalogSource
  if (incoming.defaultModelId === undefined) delete next.defaultModelId
  else next.defaultModelId = incoming.defaultModelId
  if (incoming.execution === undefined) delete next.execution
  else next.execution = incoming.execution
  return next
}
