/** One-shot decisions with read-only uncertainty recovery. Mounting a page or
 * recovering a held action never submits another mutation. */
import type { AgentRequestCreate, AgentRequestDecision, AgentRequestView } from '../../contract/agentRequests.ts'

export type AgentRequestAction =
  | { kind: 'create'; id: string; key: string; input: AgentRequestCreate }
  | { kind: 'decision'; id: string; input: AgentRequestDecision }
export interface AgentRequestAttempt {
  id: string
  state: 'sending' | 'checking' | 'uncertain' | 'refused' | 'settled'
  action?: AgentRequestAction
  row?: AgentRequestView
  error?: string
}
export interface AgentRequestActionsPort {
  submit(action: AgentRequestAction): Promise<AgentRequestView>
  read(id: string): Promise<AgentRequestView>
  accept(row: AgentRequestView): void
  definitive(error: unknown): boolean
  changed(): void
  /** Only opaque recovery coordinates; never arguments, results or credentials. */
  remember(ids: string[]): void
}
export function createAgentRequestActions(port: AgentRequestActionsPort) {
  const attempts = new Map<string, AgentRequestAttempt>()
  let generation = 0
  const publish = () => { port.remember([...attempts.values()].filter(row => !['settled', 'refused'].includes(row.state)).map(row => row.id)); port.changed() }
  const current = (at: number, attempt: AgentRequestAttempt) => generation === at && attempts.get(attempt.id) === attempt
  const settle = (attempt: AgentRequestAttempt, row: AgentRequestView): boolean => {
    if (row.id !== attempt.id || !Number.isSafeInteger(row.revision) || row.revision < 1) return false
    if (attempt.action?.kind === 'decision' && row.revision <= attempt.action.input.expectedRevision) return false
    if (attempt.action?.kind === 'create' && (row.fromAgentId !== attempt.action.input.fromAgentId ||
        row.toAgentId !== attempt.action.input.toAgentId || row.task !== attempt.action.input.task || row.role !== 'requester')) return false
    port.accept(row)
    // Canonical data lives in the API cache. Recovery retains neither the
    // approved call/reply nor a second copy of its private receipt after truth.
    attempts.set(row.id, { id: row.id, state: 'settled' })
    publish()
    return true
  }
  async function check(id: string): Promise<void> {
    const prior = attempts.get(id)
    if (!prior || prior.state === 'sending' || prior.state === 'checking') return
    const attempt: AgentRequestAttempt = { ...prior, state: 'checking', error: undefined }, at = generation
    attempts.set(id, attempt); publish()
    try {
      const row = await port.read(id)
      if (!current(at, attempt)) return
      if (settle(attempt, row)) return
    } catch { if (!current(at, attempt)) return }
    attempts.set(id, { ...attempt, state: 'uncertain', error: 'The saved outcome is not confirmed. Check again without resubmitting.' }); publish()
  }
  return {
    get(id: string): AgentRequestAttempt | undefined { return attempts.get(id) },
    all(): AgentRequestAttempt[] { return [...attempts.values()] },
    restore(ids: string[]): void {
      for (const id of ids) if (!attempts.has(id)) attempts.set(id, { id, state: 'uncertain' })
      port.changed()
    },
    async begin(action: AgentRequestAction): Promise<void> {
      const existing = attempts.get(action.id)
      if (existing && !['settled', 'refused'].includes(existing.state)) return
      const attempt: AgentRequestAttempt = { id: action.id, action: structuredClone(action), state: 'sending' }, at = generation
      attempts.set(action.id, attempt); publish()
      try {
        const row = await port.submit(attempt.action!)
        if (!current(at, attempt)) return
        if (settle(attempt, row)) return
        throw new Error('Unconfirmed acknowledgement')
      } catch (error) {
        if (!current(at, attempt)) return
        if (port.definitive(error)) {
          attempts.set(action.id, { ...attempt, state: 'refused', error: error instanceof Error ? error.message : 'The decision was refused.' }); publish(); return
        }
        attempts.set(action.id, { ...attempt, state: 'uncertain' }); publish()
        await check(action.id)
      }
    },
    check,
    dismiss(id: string): void {
      const prior = attempts.get(id)
      if (!prior || prior.state === 'sending' || prior.state === 'checking') return
      attempts.delete(id); publish()
    },
    clear(): void { generation += 1; attempts.clear(); port.changed() },
  }
}
