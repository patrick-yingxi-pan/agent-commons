/** Map a confirmed Agent Commons CRUD op (docs/agent-commons.md, D6/D9/D10/D7) to the
 *  registry caches it changed, so the Agents hub reflects it. Lives on its own — NOT
 *  in events.ts / commands.ts — so the SSE-boundary test (which scans those two router
 *  files for event `case`s) doesn't mistake this op-kind dispatch for an event handler.
 *  Single-sourced and used by BOTH the apply command (the acting client) and the
 *  ambient `relation.applied` handler (a watching one), so they can't drift. */
import type { RelationOp } from '../../contract/index.ts'
import { invalidate, invalidatePrefix } from './cache.ts'
import { keys } from './keys.ts'

/** Refresh the non-graph projections a confirmed op touched. Most relationship
 * ops need only the graph acknowledgement; an authored artifact save also mints
 * its body in the separate content projection. */
export function invalidateForCommonsOp(op: RelationOp): void {
  switch (op.kind) {
    case 'save-artifact':
      invalidate(keys.artifactContent)
      break
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
      // The roster size rides the directory card ("N contributors", D17).
      invalidatePrefix(keys.directoryProjects())
      break
    case 'set-commission-cap':
      // The D13 cap lives on the Project; refresh the projects list so the cap badge
      // updates live (a seeded Project; a created one rides the relations cache above).
      invalidate(keys.projects)
      break
    case 'set-project-default-role':
      // The D14 picker pre-selection lives on the Project too — same refresh shape.
      invalidate(keys.projects)
      break
    default:
      break
  }
}
