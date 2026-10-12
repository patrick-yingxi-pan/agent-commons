import type { ContributionMcpSelection, OpenContributionRequest, ProjectWorkMcpDraftSelection } from '../../contract/index.ts'

/** Memory-only form state. Raw JSON stays editable even when it is not a valid
 * proposal yet; neither saved drafts nor their labels grant execution authority. */
export interface ContributionCreationDraft {
  readonly title: string
  readonly summary: string
  readonly intentId?: string
  readonly initialMcpProposal?: ContributionMcpSelection
  readonly mcpDraft?: {
    selection: ProjectWorkMcpDraftSelection
    argumentsText: string
    connectionLabel: string
    transport?: 'stdio'
  }
}

/** Copy before freezing: a later edit (or a consumer of the held intent) cannot
 * change the reviewed arguments that Retry sends under the original key. */
export function snapshotContributionCreation<T extends OpenContributionRequest | ContributionCreationDraft>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (part: unknown): void => {
    if (part === null || typeof part !== 'object' || Object.isFrozen(part)) return
    Object.freeze(part)
    for (const child of Object.values(part)) freeze(child)
  }
  freeze(copy)
  return copy
}

export function submittedContributionDraft(
  request: OpenContributionRequest,
  intentId: string,
  previous?: ContributionCreationDraft,
): ContributionCreationDraft {
  return snapshotContributionCreation({
    title: request.title,
    summary: request.summary ?? '',
    intentId,
    ...(request.initialMcpProposal ? {
      initialMcpProposal: request.initialMcpProposal,
      ...(previous?.mcpDraft ? { mcpDraft: previous.mcpDraft } : {}),
    } : {}),
  })
}

export function editableContributionDraft(draft: ContributionCreationDraft): ContributionCreationDraft {
  const { intentId: _intentId, ...editable } = draft
  return snapshotContributionCreation(editable)
}
