/** Tenant-owned rolling usage. Only counters and period anchors are durable;
 * subscription ceilings remain code-owned, never imported from a backup. */
import { createUsageMeter, parseUsageMeterState, type UsageMeter, type UsageMeterState } from './usage.ts'

export type UsageMeterEntries = [string, UsageMeterState][]
const tenantKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)

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

  readForTenant(tenantId = this.defaultTenantId()): Omit<UsageMeter, 'record'> {
    if (!tenantKey(tenantId)) throw new Error('The usage tenant is invalid.')
    // A gauge/gate read for an unmetered tenant must not allocate durable rows.
    // The first reported spend, not observation, establishes a fresh period.
    return this.meters.get(tenantId) ?? createUsageMeter(this.now, false)
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
}
