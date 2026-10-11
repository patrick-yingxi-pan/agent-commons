/** Actor-private MCP follow-up review. Neither opaque server state nor submitted
 * answers belong in shared ToolActivity rows, events, or model history. */
import type { ToolActivity } from './entities.ts'
import type { McpFormInputRequest, McpFormInputResponses } from './mcpElicitation.ts'

export interface McpInputReview {
  decisionId: string
  round: number
  expiresAt: number
  connectionLabel: string
  toolName: string
  inputRequests: Record<string, McpFormInputRequest>
  canContinue: boolean
  refusal?: string
}

/** A readable conversation exposes only generic activity truth to peers. */
export interface McpInputReviewState {
  activity: ToolActivity
  review: McpInputReview | null
}

export type McpInputCommand = {
  decisionId: string
  round: number
  /** One client-minted UUID for this exact reviewed action, never regenerated
   * during recovery. Receipt reads cannot dispatch an external request. */
  responseId: string
} & (
  | { action: 'respond'; responses: McpFormInputResponses }
  | { action: 'stop' }
)

export interface McpInputReceipt {
  responseId: string
  decisionId: string
  round: number
  action: 'respond' | 'stop'
  /** Current public truth, not an instruction to replay this round. */
  activity: ToolActivity
}
