/** Explicit backup rollback withdraws local-program permission before the
 * replacement can start. Reading a backup or ordinary restart does not do so. */
import type { PersistedState } from './format.ts'
import { parseRoutineMcpRegistryState } from '../routineMcpRegistry.ts'
import { revokeRoutineMcpPolicy, routineMcpInteger } from '../routineMcpPolicy.ts'
import { interruptRoutineMcpRun } from '../routineMcpState.ts'

/** The caller supplies a detached, fully validated snapshot and validates the
 * transformed result before any write. No runtime/native capability is needed. */
export function prepareRoutineRestoreState(state: PersistedState, now = Date.now()): PersistedState {
  if (!routineMcpInteger(now)) throw new Error('Invalid Routine restore timestamp.')
  if (state.routineMcp === undefined) return state
  const registry = parseRoutineMcpRegistryState(state.routineMcp)
  const tasks = new Map(state.schedules.map(task => [task.id, task]))
  const affected = new Set<string>()
  registry.policies = registry.policies.map(permission => {
    if (!permission.localAuthority) return permission
    affected.add(permission.routineId)
    return revokeRoutineMcpPolicy(permission, permission.policy.revision)
  })
  registry.runs = registry.runs.map(ledger => {
    if (!ledger.permission.localAuthority) return ledger
    const task = tasks.get(ledger.permission.routineId)
    const run = task?.runs.find(run => run.id === ledger.runId)
    if (!task || !run || (run.status !== 'running' && !ledger.calls.some(call => call.status === 'pending'))) return ledger
    affected.add(task.id)
    // Unlike ordinary restart, explicit restore also ends an unattempted queued
    // local run. It must not revive after the person approves a later grant.
    const interrupted = { ...interruptRoutineMcpRun(ledger, now), phase: 'interrupted' as const }
    if (run.status === 'running') {
      run.status = 'failed'
      run.failureCode = 'execution_error'
      run.duration = `${Math.max(0, Math.ceil((now - run.at) / 1000))}s`
      run.summary = `Failed after ${run.attempts ?? 0} attempt${run.attempts === 1 ? '' : 's'}`
      run.detail = 'Stopped after restoring a backup containing local-program authority. Local programs may already have had effects. Review the saved call receipts and renew permission before enabling this Routine.'
      delete run.nextAttemptAt
      task.lastStatus = 'failed'
    }
    return interrupted
  })
  for (const id of affected) {
    const task = tasks.get(id)
    if (!task) throw new Error('Restored local Routine is missing.')
    if (task.enabled || task.next !== 'Paused — review external calls' || task.nextFireAt !== undefined) {
      task.revision = (task.revision ?? 0) + 1
    }
    task.enabled = false
    task.next = 'Paused — review external calls'
    delete task.nextFireAt
  }
  state.routineMcp = parseRoutineMcpRegistryState(registry)
  return state
}
