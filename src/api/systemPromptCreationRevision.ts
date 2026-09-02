import type { CreateSystemPromptRequest } from '../../contract/index.ts'

/** One submitted New-Prompt form owns one immutable request and retry identity. */
export interface SystemPromptCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly request: CreateSystemPromptRequest
}

export const systemPromptCreationResourceId = (intent: SystemPromptCreationIntent): string =>
  `system-prompt-create:${intent.intentId}`
