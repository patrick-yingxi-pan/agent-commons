/** Eager hold facade for exact-run stop requests; transport stays lazy. */
import { onAccountSwitch } from '../api/account.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome, type RevisionedMutationStatus } from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'
import type { ScheduleRunStopIntent } from '../api/scheduleRunStopCommands.ts'

type Runtime = typeof import('./scheduleRunStopRuntime')
type AccountSwitchListener = (listener: () => void) => () => void

interface HeldStop {
  intent: ScheduleRunStopIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (outcome: RevisionedMutationOutcome) => void
  generation: number
  loading: boolean
}

export function createScheduleRunStopMutationFacade(options: {
  loadRuntime: () => Promise<Runtime>
  subscribeAccountSwitch?: AccountSwitchListener
  onStatus?: (status: RevisionedMutationStatus) => void
}) {
  const statusStore = createMutationStatusStore()
  const heldRuns = new Map<string, HeldStop>()
  const failures = createRuntimeLoadFailureTracker()
  let runtime: Runtime | null = null
  let generation = 0
  const publish = (status: RevisionedMutationStatus): void => {
    statusStore.publish(status)
    options.onStatus?.(status)
  }
  const loadRuntime = createRetryableRuntimeLoader<Runtime>(options.loadRuntime, (loaded) => { runtime = loaded })
  const runKey = ({ scheduleId, runId }: ScheduleRunStopIntent): string => `${scheduleId}\0${runId}`
  const publishLoadFailure = (): void => publish(failures.status(
    heldRuns.size,
    'Couldn’t load the Stop controller. No Stop request was sent. Retry this exact Stop or Dismiss. If Retry still cannot load, copy unsent text before reloading the app.',
  ))

  const release = (key: string, held: HeldStop): void => {
    if (held.generation !== generation || heldRuns.get(key) !== held) return
    heldRuns.delete(key)
    failures.remove(key, heldRuns.keys())
    if (runtime) statusStore.refresh()
    else publishLoadFailure()
  }

  const activate = (key: string, held: HeldStop): void => {
    if (held.loading || heldRuns.get(key) !== held) return
    held.loading = true
    publish({
      ...IDLE_REVISIONED_MUTATION,
      busy: true,
      activeResourceId: key,
      pendingCount: heldRuns.size,
    })
    void loadRuntime().then(
      (loaded) => {
        held.loading = false
        if (held.generation !== generation || heldRuns.get(key) !== held) {
          held.settle('discarded')
          return
        }
        void loaded.enqueueScheduleRunStopRuntime(held.intent).then(held.settle)
      },
      () => {
        held.loading = false
        if (held.generation !== generation || heldRuns.get(key) !== held) return
        failures.fail(key)
        publishLoadFailure()
      },
    )
  }

  const stopAccountSwitch = (options.subscribeAccountSwitch ?? onAccountSwitch)(() => {
    generation += 1
    failures.clear()
    const abandoned = [...heldRuns.values()]
    heldRuns.clear()
    for (const held of abandoned) held.settle('discarded')
    if (runtime) runtime.clearScheduleRunStops()
    else publish(IDLE_REVISIONED_MUTATION)
  })

  const enqueue = (intent: ScheduleRunStopIntent): Promise<RevisionedMutationOutcome> => {
    const key = runKey(intent)
    const existing = heldRuns.get(key)
    if (existing) return existing.result
    const issuedGeneration = generation
    const frozenIntent = Object.freeze({ scheduleId: intent.scheduleId, runId: intent.runId })
    let settle!: (outcome: RevisionedMutationOutcome) => void
    const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
    const held: HeldStop = { intent: frozenIntent, result, settle, generation: issuedGeneration, loading: false }
    heldRuns.set(key, held)
    void result.then(() => release(key, held))
    if (failures.active()) publishLoadFailure()
    else activate(key, held)
    return result
  }

  const retry = (): void => {
    if (runtime) {
      runtime.retryScheduleRunStopRuntime()
      return
    }
    failures.retry()
    for (const [key, held] of heldRuns) activate(key, held)
  }

  const dismiss = (): void => {
    if (runtime) {
      runtime.discardScheduleRunStopRuntime()
      return
    }
    const active = failures.active()
    if (active) heldRuns.get(active)?.settle('discarded')
  }

  return {
    enqueue,
    retry,
    dismiss,
    isHeld: (intent: ScheduleRunStopIntent): boolean => heldRuns.has(runKey(intent)),
    isHeldForTask: (scheduleId: string): boolean => [...heldRuns.keys()].some(key => key.startsWith(`${scheduleId}\0`)),
    useStatus: statusStore.useStatus,
    publishStatus: publish,
    dispose: stopAccountSwitch,
  }
}

const facade = createScheduleRunStopMutationFacade({
  loadRuntime: () => import('./scheduleRunStopRuntime'),
})

export const publishScheduleRunStopStatus = facade.publishStatus
export const isScheduleRunStopHeld = facade.isHeld
export const isScheduleRunStopHeldForTask = facade.isHeldForTask
export const enqueueScheduleRunStop = facade.enqueue
export const retryScheduleRunStop = facade.retry
export const discardScheduleRunStop = facade.dismiss
export const useScheduleRunStopStatus = facade.useStatus
