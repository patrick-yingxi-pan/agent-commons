import type { SystemPromptEntry } from '../../contract/index.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

/** Merge only the authored prompt definition. Viewer-default selection is a
 * separate serve-time pointer and must survive a delayed definition response. */
export function mergeSystemPromptDefinition(
  current: SystemPromptEntry,
  incoming: SystemPromptEntry,
): SystemPromptEntry {
  if (!shouldAcceptEntityRevision(current.definitionRevision, incoming.definitionRevision)) return current
  return {
    ...current,
    label: incoming.label,
    body: incoming.body,
    targetFamily: incoming.targetFamily,
    definitionRevision: incoming.definitionRevision,
  }
}
