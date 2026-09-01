/** Low-frequency direct Project creation, loaded only when the Projects workflow
 * needs it. Reads still arrive through the shared cache and relation graph. */
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  Project,
  RelationGraph,
} from '../../contract/index.ts'
import { apiPost } from './client.ts'
import { invalidate, invalidatePrefix, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { shouldAcceptRelationGraph } from './relationRevision.ts'

/** Create a Project without inventing identity in the browser. The returned
 * graph is the acknowledgement; a newer ambient graph wins by revision. */
export async function createProject(
  input: CreateProjectRequest,
  idempotencyKey: string,
): Promise<Project> {
  const created = await apiPost<CreateProjectResponse>(paths.projects, input, { idempotencyKey })
  if (shouldAcceptRelationGraph(peek<RelationGraph>(keys.relations), created.graph)) {
    setData(keys.relations, created.graph)
  }
  invalidatePrefix(keys.ownerProfile())
  invalidatePrefix(keys.search())
  invalidatePrefix(keys.directoryProjects())
  return created.project
}

/** Re-read runtime Projects after an uncertain create acknowledgement. */
export function reconcileProjectCreation(): void {
  invalidate(keys.relations)
}
