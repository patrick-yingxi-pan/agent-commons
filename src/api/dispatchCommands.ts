/** Lazy transport for acknowledgement-gated one-off Dispatch creation. */
import type {
  CreateDispatchRequest,
  DispatchBinding,
  DispatchRun,
  ProjectWorkDraftInput,
  ProjectWorkDraftSource,
  ProjectWorkMcpDraftSelection,
} from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { invalidate, peek } from './cache.ts'
import { manualDispatchRunId } from './dispatchIdentity.ts'

export interface DispatchIntent {
  intentId: string
  tenantId: string
  title: string
  detail?: string
  execution: DispatchBinding
  /** A Project-work draft uses this source instead of title/detail on the wire.
   * `title` remains only the local status label for the held action. */
  projectWork?: ProjectWorkDraftSource
  /** Display-only snapshot retained while an acknowledged request is held. */
  projectWorkLabels?: { commission: string; provider: string; model: string }
  /** Exact selected MCP tool for a workspace-scoped, non-executing argument draft. */
  mcpProposal?: ProjectWorkMcpDraftSelection
  /** Display-only MCP labels retained while the same keyed request is held. */
  mcpProposalLabels?: { connection: string; tool: string }
}

export interface DispatchBaseline {
  tenantId: string
  runIds: readonly string[]
}

export function dispatchBaseline(intent: DispatchIntent): DispatchBaseline {
  return {
    tenantId: intent.tenantId,
    runIds: peek<DispatchRun[]>(keys.dispatch)?.map((run) => run.id) ?? [],
  }
}

export async function createDispatch(intent: DispatchIntent, idempotencyKey: string): Promise<void> {
  const body = intent.projectWork
    ? {
        execution: intent.execution,
        projectWork: intent.projectWork,
        ...(intent.mcpProposal ? { mcpProposal: intent.mcpProposal } : {}),
      } satisfies ProjectWorkDraftInput
    : { title: intent.title, detail: intent.detail, execution: intent.execution } satisfies CreateDispatchRequest
  await apiPost<DispatchRun>(
    paths.dispatch,
    body,
    { idempotencyKey },
  )
  // A result conversation can be deleted on another device before the POST
  // arrives. Only generation-fenced query reads may project the current feed.
  invalidate(keys.dispatch)
  invalidate(keys.sessions)
}

export async function reconcileDispatch(
  _intent: DispatchIntent,
  baseline: DispatchBaseline,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await manualDispatchRunId(baseline.tenantId, idempotencyKey)
  const incoming = await apiGet<DispatchRun[]>(paths.dispatch)
  invalidate(keys.dispatch)
  invalidate(keys.sessions)
  return !baseline.runIds.includes(expectedId) && incoming.some((run) => run.id === expectedId)
}
