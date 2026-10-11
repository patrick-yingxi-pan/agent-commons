/** An explicit action owns one frozen command. Recovery reads, never retries. */
import type { McpInputReview } from '../../contract/mcpInput.ts'
import type { McpInputScope } from '../api/mcpInputCommands.ts'
import { readMcpInput, readMcpInputReceipt, submitMcpInputOnce, refreshMcpInputReview } from '../api/mcpInputCommands.ts'
import { compileMcpInputDraft, emptyMcpInputDraft, type McpInputDraft } from '../lib/mcpInputDraft.ts'
import { mcpInputGeneration, mcpInputHeld, setMcpInputHeld, type McpInputAttempt } from './mcpInputState.ts'

export function beginMcpInput(scope: McpInputScope, review: McpInputReview, action: 'respond' | 'stop', draft: McpInputDraft): void {
  if (mcpInputHeld(scope)?.attempt || review.decisionId !== scope.decisionId ||
      (action === 'respond' && (!review.canContinue || review.expiresAt <= Date.now()))) return
  const generation = mcpInputGeneration()
  const frozenDraft = structuredClone(draft)
  const frozenReview = structuredClone(review)
  const command = {
    decisionId: review.decisionId, round: review.round, responseId: crypto.randomUUID(),
    ...(action === 'respond' ? { action, responses: compileMcpInputDraft(review, frozenDraft) } : { action }),
  }
  const attempt: McpInputAttempt = { scope: { ...scope }, command, state: 'submitting' }
  setMcpInputHeld(scope, { round: review.round, draft: frozenDraft, review: frozenReview, attempt })
  void (async () => {
    try {
      const receipt = await submitMcpInputOnce(attempt.scope, attempt.command)
      if (generation !== mcpInputGeneration() || mcpInputHeld(scope)?.attempt !== attempt) return
      setMcpInputHeld(scope, { round: review.round, draft: frozenDraft, review: frozenReview, attempt: { ...attempt, state: 'receipt', receipt } })
    } catch {
      if (generation !== mcpInputGeneration() || mcpInputHeld(scope)?.attempt !== attempt) return
      setMcpInputHeld(scope, { round: review.round, draft: frozenDraft, review: frozenReview, attempt: { ...attempt, state: 'uncertain' } })
      await checkMcpInput(scope)
    }
  })()
}

export async function checkMcpInput(scope: McpInputScope): Promise<void> {
  const current = mcpInputHeld(scope)
  if (!current?.attempt || current.attempt.state === 'submitting' || current.attempt.state === 'checking') return
  const generation = mcpInputGeneration()
  const checking: McpInputAttempt = { ...current.attempt, state: 'checking', error: undefined }
  setMcpInputHeld(scope, { ...current, attempt: checking })
  try {
    const receipt = await readMcpInputReceipt(checking.scope, checking.command)
    if (generation !== mcpInputGeneration() || mcpInputHeld(scope)?.attempt !== checking) return
    setMcpInputHeld(scope, { ...current, attempt: receipt
      ? { ...checking, state: 'receipt', receipt }
      : { ...checking, state: current.attempt.receipt ? 'receipt' : 'uncertain' } })
  } catch {
    if (generation !== mcpInputGeneration() || mcpInputHeld(scope)?.attempt !== checking) return
    setMcpInputHeld(scope, { ...current, attempt: { ...current.attempt, error: 'Couldn’t read the saved response. Check status again.' } })
  }
}

/** Explicitly reopen only fresh server truth. This is never a resend, even when
 * the previous receipt is absent. The server still owns the round CAS fence. */
export async function reviewLatestMcpInput(scope: McpInputScope): Promise<void> {
  const current = mcpInputHeld(scope)
  if (!current?.attempt || current.attempt.state === 'submitting' || current.attempt.state === 'checking') return
  const generation = mcpInputGeneration()
  const checking: McpInputAttempt = { ...current.attempt, state: 'checking', error: undefined }
  setMcpInputHeld(scope, { ...current, attempt: checking })
  try {
    const latest = await readMcpInput(scope)
    if (generation !== mcpInputGeneration() || mcpInputHeld(scope)?.attempt !== checking) return
    // A running activity may still be executing the lost response. Do not
    // release its local recovery handle merely because the form is absent.
    if (latest.activity.status === 'running') {
      setMcpInputHeld(scope, { ...current, attempt: { ...current.attempt,
        error: 'The tool is still running. Check status; nothing will be sent again.' } })
      return
    }
    refreshMcpInputReview(scope.sessionId)
    setMcpInputHeld(scope, latest.review
      ? { round: latest.review.round, draft: emptyMcpInputDraft(latest.review) }
      : null)
  } catch {
    if (generation !== mcpInputGeneration() || mcpInputHeld(scope)?.attempt !== checking) return
    setMcpInputHeld(scope, { ...current, attempt: { ...current.attempt,
      error: 'Couldn’t read the latest review. Your response remains held; nothing was sent again.' } })
  }
}
