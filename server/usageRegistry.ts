/** Tenant-owned rolling usage. Only counters and period anchors are durable;
 * subscription ceilings remain code-owned, never imported from a backup. */
import type { Budget } from '../contract/index.ts'
import {
  createUsageMeter, MAX_USAGE_STATE_START, parseUsageMeterState, USAGE_WINDOW_DEFINITIONS,
  type UsageMeter, type UsageMeterState,
} from './usage.ts'

export type UsageMeterEntries = [string, UsageMeterState][]
const MAX_RESERVATIONS = 10_000
const MAX_ID_LENGTH = 256
const tenantKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
const reservationId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= MAX_ID_LENGTH && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)

export interface UsageReservationState {
  id: string
  tenantId: string
  allowance: number
  fiveHourStart: number
  weeklyStart: number
  status: 'active' | 'uncertain' | 'settled'
  /** Exactly one model response is expected for each reservation. */
  report: { inputTokens: number; outputTokens: number } | null
}

export class UsageReservationError extends Error {
  readonly code: 'invalid' | 'stale' | 'limit'
  constructor(code: UsageReservationError['code']) {
    super(`Model usage reservation ${code}.`)
    this.name = 'UsageReservationError'
    this.code = code
  }
}

const safeCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const exactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value &&
  typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

export function parseUsageReservations(value: unknown): UsageReservationState[] {
  if (!Array.isArray(value) || value.length > MAX_RESERVATIONS) throw new UsageReservationError('invalid')
  const seen = new Set<string>()
  return value.map(row => {
    if (!exactRecord(row, ['id', 'tenantId', 'allowance', 'fiveHourStart', 'weeklyStart', 'status', 'report']) ||
        !reservationId(row.id) || !tenantKey(row.tenantId) || seen.has(row.id) ||
        !Number.isSafeInteger(row.allowance) || (row.allowance as number) <= 0 ||
        !Number.isSafeInteger(row.fiveHourStart) || (row.fiveHourStart as number) < 0 || (row.fiveHourStart as number) > MAX_USAGE_STATE_START ||
        !Number.isSafeInteger(row.weeklyStart) || (row.weeklyStart as number) < 0 || (row.weeklyStart as number) > MAX_USAGE_STATE_START ||
        !['active', 'uncertain', 'settled'].includes(row.status as string)) throw new UsageReservationError('invalid')
    seen.add(row.id)
    let report: UsageReservationState['report'] = null
    if (row.report !== null) {
      if (!exactRecord(row.report, ['inputTokens', 'outputTokens']) || !safeCount(row.report.inputTokens) ||
          !safeCount(row.report.outputTokens) || !Number.isSafeInteger(row.report.inputTokens + row.report.outputTokens)) {
        throw new UsageReservationError('invalid')
      }
      report = { inputTokens: row.report.inputTokens, outputTokens: row.report.outputTokens }
    }
    if (row.status === 'settled' && report === null) throw new UsageReservationError('invalid')
    return { id: row.id, tenantId: row.tenantId, allowance: row.allowance as number,
      fiveHourStart: row.fiveHourStart as number, weeklyStart: row.weeklyStart as number,
      status: row.status as UsageReservationState['status'], report }
  })
}

const overBudget = (budgets: readonly (Budget | undefined)[], labels: readonly string[]): { label: string; ceiling: number } | undefined => {
  for (const budget of budgets) {
    if (budget === undefined) continue
    if (!budget || !Array.isArray(budget.windows)) return { label: 'invalid budget', ceiling: 0 }
    const seen = new Set<string>()
    for (const window of budget.windows) {
      if (!window || typeof window.label !== 'string' || !safeCount(window.ceiling) ||
          !labels.includes(window.label) || seen.has(window.label)) return { label: typeof window?.label === 'string' ? window.label : 'invalid budget', ceiling: 0 }
      seen.add(window.label)
    }
  }
  return undefined
}

export function parseUsageMeterEntries(value: unknown): UsageMeterEntries {
  if (!Array.isArray(value)) throw new Error('The persisted usage meters are invalid.')
  const seen = new Set<string>()
  const entries: UsageMeterEntries = []
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2 || !tenantKey(row[0]) || seen.has(row[0])) {
      throw new Error('The persisted usage meters are invalid.')
    }
    seen.add(row[0])
    entries.push([row[0], parseUsageMeterState(row[1])])
  }
  return entries
}

export class UsageRegistry {
  private meters = new Map<string, UsageMeter>()
  private reservations = new Map<string, UsageReservationState>()
  private readonly now: () => number
  private readonly defaultTenantId: () => string

  constructor(now: () => number, defaultTenantId: () => string) {
    this.now = now
    this.defaultTenantId = defaultTenantId
    this.meters.set(defaultTenantId(), createUsageMeter(now))
  }

  record(inputTokens: number, outputTokens: number, tenantId = this.defaultTenantId()): void {
    if (!tenantKey(tenantId)) throw new Error('The usage tenant is invalid.')
    const meter = this.meters.get(tenantId) ?? createUsageMeter(this.now, false)
    // A rejected first report must not retain even an empty tenant/period.
    meter.record(inputTokens, outputTokens)
    this.meters.set(tenantId, meter)
  }

  /** Reserve one bounded model response before I/O. True means newly reserved;
   * false is an exact idempotent replay. Capacity checks and insertion are sync. */
  reserve(id: string, tenantId: string, allowance: number, budgets: readonly (Budget | undefined)[] = []): boolean {
    if (!reservationId(id) || !tenantKey(tenantId) || !Number.isSafeInteger(allowance) || allowance <= 0) {
      throw new UsageReservationError('invalid')
    }
    const labels = USAGE_WINDOW_DEFINITIONS.map(window => window.label)
    const invalid = overBudget(budgets, labels)
    if (invalid) throw new UsageReservationError('invalid')
    const existing = this.reservations.get(id)
    if (existing) {
      if (existing.tenantId !== tenantId || existing.allowance !== allowance || existing.status !== 'active' || existing.report !== null) {
        throw new UsageReservationError('stale')
      }
      return false
    }
    if (this.reservations.size >= MAX_RESERVATIONS) throw new UsageReservationError('limit')

    const meter = this.meters.get(tenantId) ?? createUsageMeter(this.now, false)
    const meterState = meter.snapshot()
    const planned = labels.map(label => this.effectiveCeiling(meter.planCeilings().find(row => row.label === label)!, label, budgets))
    if (planned.some((ceiling, index) =>
      meterState[USAGE_WINDOW_DEFINITIONS[index]!.key].consumed + this.reservedFor(tenantId, labelAt(index)) + allowance > ceiling)) {
      throw new UsageReservationError('limit')
    }
    this.meters.set(tenantId, meter)
    this.reservations.set(id, { id, tenantId, allowance, fiveHourStart: meterState.fiveHour.start,
      weeklyStart: meterState.weekly.start, status: 'active', report: null })
    return true
  }

  /** Report one settled response exactly once, even if the caller replays its
   * durable callback after an acknowledgement was lost. Actual usage is never
   * clipped to the reservation allowance. */
  recordReserved(id: string, tenantId: string, inputTokens: number, outputTokens: number): boolean {
    const row = this.reservations.get(id)
    if (!row || row.tenantId !== tenantId || !safeCount(inputTokens) || !safeCount(outputTokens) ||
        !Number.isSafeInteger(inputTokens + outputTokens)) throw new UsageReservationError('invalid')
    if (row.report) {
      if (row.report.inputTokens !== inputTokens || row.report.outputTokens !== outputTokens) throw new UsageReservationError('stale')
      return false
    }
    if (row.status === 'settled') throw new UsageReservationError('stale')
    this.record(inputTokens, outputTokens, tenantId)
    row.report = { inputTokens, outputTokens }
    return true
  }

  /** Known completion releases unused allowance. Unknown completion remains a
   * capacity hold until reconciled or its anchored usage windows expire. */
  settleReservation(id: string, tenantId: string, knownUsage: boolean): void {
    const row = this.reservations.get(id)
    if (!row || row.tenantId !== tenantId || typeof knownUsage !== 'boolean') throw new UsageReservationError('invalid')
    if (knownUsage && !row.report) throw new UsageReservationError('stale')
    if (knownUsage) row.status = 'settled'
    else if (row.status !== 'settled') row.status = 'uncertain'
  }

  reserved(tenantId = this.defaultTenantId()): number {
    if (!tenantKey(tenantId)) throw new UsageReservationError('invalid')
    return this.activeRows(tenantId).reduce((sum, row) => {
      return sum + (this.hasLiveHold(row) ? this.remaining(row) : 0)
    }, 0)
  }

  snapshotReservations(): UsageReservationState[] {
    return parseUsageReservations([...this.reservations.values()])
  }

  /** Continue an admitted request, counting its own hold exactly once. Equality
   * is allowed: reserve() already admitted that last unit of capacity. */
  reservationWithinLimits(id: string, tenantId: string, budgets: readonly (Budget | undefined)[] = []): boolean {
    const row = this.reservations.get(id)
    if (!row || row.tenantId !== tenantId || row.status === 'uncertain' ||
        overBudget(budgets, USAGE_WINDOW_DEFINITIONS.map(window => window.label))) return false
    const meter = this.meters.get(tenantId)
    if (!meter) return false
    const state = meter.snapshot()
    return USAGE_WINDOW_DEFINITIONS.every(window => {
      const ceiling = this.effectiveCeiling(meter.planCeilings().find(base => base.label === window.label)!, window.label, budgets)
      return state[window.key].consumed + this.reservedFor(tenantId, window.label) <= ceiling
    })
  }

  /** Undefined is an older snapshot with no reservation slice; explicit empty
   * state stays empty. Validate before replacing current rows. */
  rehydrateReservations(value: unknown): void {
    const rows = value === undefined ? [] : parseUsageReservations(value)
    this.reservations = new Map(rows.map(row => [row.id, row]))
  }

  /** A process restart cannot prove an active request's final provider usage. */
  recoverReservations(): boolean {
    let changed = false
    for (const row of this.reservations.values()) {
      if (row.status === 'active') { row.status = 'uncertain'; changed = true }
    }
    return changed
  }

  readForTenant(tenantId = this.defaultTenantId()): Omit<UsageMeter, 'record'> {
    if (!tenantKey(tenantId)) throw new Error('The usage tenant is invalid.')
    // A gauge/gate read for an unmetered tenant must not allocate durable rows.
    // The first reported spend, not observation, establishes a fresh period.
    const meter = this.meters.get(tenantId) ?? createUsageMeter(this.now, false)
    return {
      planLimits: () => meter.planLimits(),
      planCeilings: () => meter.planCeilings(),
      snapshot: () => meter.snapshot(),
      overLimit: budget => this.overLimit(tenantId, [budget]),
    }
  }

  planCeilings() { return this.readForTenant().planCeilings() }

  snapshot(): UsageMeterEntries {
    return [...this.meters].map(([id, meter]) => [id, meter.snapshot()])
  }

  rehydrate(value: UsageMeterEntries | undefined, demoWorld: boolean): void {
    // Validate everything before replacing live meters. An absent older slice
    // gets its historical baseline once; present empty state never re-seeds.
    const entries = value === undefined ? undefined : parseUsageMeterEntries(value)
    const next = new Map<string, UsageMeter>()
    if (entries === undefined) next.set(this.defaultTenantId(), createUsageMeter(this.now, demoWorld))
    else for (const [id, state] of entries) next.set(id, createUsageMeter(this.now, false, state))
    this.meters = next
  }

  /** Intersect every applicable ceiling per window, including existing holds.
   * Omitted windows add no constraint; reads never allocate a tenant meter. */
  overLimit(tenantId = this.defaultTenantId(), budgets: readonly (Budget | undefined)[] = []): { label: string; ceiling: number } | null {
    if (!tenantKey(tenantId)) throw new Error('The usage tenant is invalid.')
    const invalid = overBudget(budgets, USAGE_WINDOW_DEFINITIONS.map(window => window.label))
    if (invalid) return invalid
    const meter = this.meters.get(tenantId) ?? createUsageMeter(this.now, false)
    const state = meter.snapshot()
    const baseWindows = meter.planCeilings()
    const now = this.now()
    for (const window of USAGE_WINDOW_DEFINITIONS) {
      const base = baseWindows.find(row => row.label === window.label)!
      const ceiling = this.effectiveCeiling(base, window.label, budgets)
      const usageWindow = state[window.key]
      const occupancy = usageWindow.consumed + this.reservedFor(tenantId, window.label, now)
      if (occupancy >= ceiling) return { label: window.label, ceiling }
    }
    return null
  }

  private effectiveCeiling(base: { label: string; ceiling: number }, label: string,
    budgets: readonly (Budget | undefined)[]): number {
    let ceiling = base.ceiling
    for (const budget of budgets) {
      const child = budget?.windows.find(window => window.label === label)
      if (child) ceiling = Math.min(ceiling, child.ceiling)
    }
    return ceiling
  }

  private activeRows(tenantId: string): UsageReservationState[] {
    return [...this.reservations.values()].filter(row => row.tenantId === tenantId && row.status !== 'settled')
  }

  private reservedFor(tenantId: string, label: string, now = this.now()): number {
    return this.activeRows(tenantId).reduce((sum, row) => {
      if (row.status === 'active') return sum + this.remaining(row)
      const start = label === USAGE_WINDOW_DEFINITIONS[0].label ? row.fiveHourStart : row.weeklyStart
      const definition = USAGE_WINDOW_DEFINITIONS.find(window => window.label === label)!
      // A reservation anchored in an older window expires only once the clock
      // has passed its whole interval; rollback before its start never releases it.
      if (now >= start && now - start >= definition.windowMs) return sum
      return sum + this.remaining(row)
    }, 0)
  }

  private hasLiveHold(row: UsageReservationState): boolean {
    if (row.status === 'active') return true
    const now = this.now()
    return USAGE_WINDOW_DEFINITIONS.some(window => {
      const start = window.key === 'fiveHour' ? row.fiveHourStart : row.weeklyStart
      return !(now >= start && now - start >= window.windowMs)
    })
  }

  private remaining(row: UsageReservationState): number {
    return row.status === 'settled' ? 0 : Math.max(0, row.allowance - (row.report?.inputTokens ?? 0) - (row.report?.outputTokens ?? 0))
  }
}

const labelAt = (index: number): string => USAGE_WINDOW_DEFINITIONS[index]!.label
