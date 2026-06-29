/** Map a confirmed Agent Commons CRUD op (docs/agent-commons.md, D6/D9/D10/D7) to the
 *  registry caches it changed, so the Agents hub reflects it. Lives on its own — NOT
 *  in events.ts / commands.ts — so the SSE-boundary test (which scans those two router
 *  files for event `case`s) doesn't mistake this op-kind dispatch for an event handler.
 *  Single-sourced and used by BOTH the apply command (the acting client) and the
 *  ambient `relation.applied` handler (a watching one), so they can't drift. */
import type { RelationOp } from '../../contract/index.ts'
import { invalidate } from './cache.ts'
import { keys } from './keys.ts'

/** Refresh the registry caches a confirmed CRUD op touched. A relationship-graph op
 *  (file/save/scope/…) edits no registry, so it falls through to a no-op. */
export function invalidateForCommonsOp(op: RelationOp): void {
  switch (op.kind) {
    case 'create-provider':
      invalidate(keys.providers)
      break
    case 'create-prompt':
      invalidate(keys.systemPrompts)
      break
    case 'create-agent':
      invalidate(keys.workerAgents)
      break
    case 'commission-agent':
    case 'uncommission-agent':
      invalidate(keys.commissions(op.projectId))
      invalidate(keys.commissions())
      break
    case 'set-commission-cap':
      // The D13 cap lives on the Project; refresh the projects list so the cap badge
      // updates live (a seeded Project; a created one rides the relations cache above).
      invalidate(keys.projects)
      break
    default:
      break
  }
}
