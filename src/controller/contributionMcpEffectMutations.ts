/** Account-scoped one-shot MCP effect state. Ambiguous runs can only read a receipt. */
import type { ContributionMcpEffectIntent } from '../api/contributionMcpEffectCommands.ts'
import type { ContributionEffectRun } from '../../contract/contributionExecution.ts'
import {
  contributionMcpEffectAttempt,
  contributionMcpEffectGeneration,
  setContributionMcpEffectAttempt,
  type ContributionMcpAttempt,
} from './contributionMcpEffectAttemptState.ts'

export { contributionMcpEffectAttempt, useContributionMcpEffectAttempt } from './contributionMcpEffectAttemptState.ts'
export type { ContributionMcpAttempt } from './contributionMcpEffectAttemptState.ts'
type Commands = typeof import('../api/contributionMcpEffectCommands.ts')
let commandsPromise: Promise<Commands> | null = null
const loadCommands = (): Promise<Commands> => {
  commandsPromise ??= import('../api/contributionMcpEffectCommands.ts')
  return commandsPromise
}
/** Load transport before the lazy consent UI is admitted; a failed module load
 * must never be mistaken for an uncertain POST that may have reached a server. */
export const prepareContributionMcpEffectCommands = (): Promise<Commands> => loadCommands()

/** Confirmed by the user at the call site. Exactly one POST is issued per key. */
export function beginContributionMcpEffect(intent: ContributionMcpEffectIntent): void {
  if (contributionMcpEffectAttempt(intent.projectId, intent.contributionId) !== null) return
  const issued = contributionMcpEffectGeneration()
  const attempt: ContributionMcpAttempt = { intent: { ...intent }, idempotencyKey: crypto.randomUUID(), state: 'submitting' }
  setContributionMcpEffectAttempt(intent.projectId, intent.contributionId, attempt)
  void (async () => {
    let found: ContributionEffectRun | undefined
    try {
      const commands = await loadCommands()
      if (issued !== contributionMcpEffectGeneration() || contributionMcpEffectAttempt(intent.projectId, intent.contributionId) !== attempt) return
      found = (await commands.submitContributionMcpEffectOnce(attempt.intent, attempt.idempotencyKey)).receipt
    } catch {
      // The POST may have reached the server. Never send it again; ask for its
      // durable receipt using the one identity already minted above.
      if (issued !== contributionMcpEffectGeneration() || contributionMcpEffectAttempt(intent.projectId, intent.contributionId) !== attempt) return
      const checking = { ...attempt, state: 'checking' as const }
      setContributionMcpEffectAttempt(intent.projectId, intent.contributionId, checking)
      try { found = (await (await loadCommands()).readContributionMcpEffectReceipt(attempt.intent, attempt.idempotencyKey))?.receipt }
      catch { /* Retain uncertainty and offer another read-only check. */ }
    }
    if (issued !== contributionMcpEffectGeneration() || contributionMcpEffectAttempt(intent.projectId, intent.contributionId) === null) return
    setContributionMcpEffectAttempt(intent.projectId, intent.contributionId, found
      ? { ...attempt, state: found.status === 'pending' ? 'pending' : 'receipt', receipt: found }
      : { ...attempt, state: 'uncertain' })
  })()
}

/** Explicit recovery performs only GET. It cannot issue the original POST. */
export async function checkContributionMcpEffectReceipt(projectId: string, contributionId: string): Promise<void> {
  const attempt = contributionMcpEffectAttempt(projectId, contributionId)
  if (!attempt || attempt.state === 'submitting' || attempt.state === 'checking') return
  const issued = contributionMcpEffectGeneration()
  const checking: ContributionMcpAttempt = { ...attempt, state: 'checking' }
  setContributionMcpEffectAttempt(projectId, contributionId, checking)
  try {
    const found = await (await loadCommands()).readContributionMcpEffectReceipt(attempt.intent, attempt.idempotencyKey)
    if (issued !== contributionMcpEffectGeneration() || contributionMcpEffectAttempt(projectId, contributionId) !== checking) return
    setContributionMcpEffectAttempt(projectId, contributionId, found
      ? { ...checking, state: found.receipt.status === 'pending' ? 'pending' : 'receipt', receipt: found.receipt }
      : attempt.state === 'pending'
        ? attempt
        : { ...checking, state: 'uncertain', receipt: undefined })
  } catch {
    if (issued !== contributionMcpEffectGeneration() || contributionMcpEffectAttempt(projectId, contributionId) !== checking) return
    setContributionMcpEffectAttempt(projectId, contributionId, attempt.state === 'pending' ? attempt : { ...checking, state: 'uncertain', receipt: undefined })
  }
}

/** Dismissal clears only local recovery state; it makes no claim about the act. */
export function dismissContributionMcpEffectAttempt(projectId: string, contributionId: string): void {
  const attempt = contributionMcpEffectAttempt(projectId, contributionId)
  if (!attempt || attempt.state === 'submitting' || attempt.state === 'checking') return
  setContributionMcpEffectAttempt(projectId, contributionId, null)
}
