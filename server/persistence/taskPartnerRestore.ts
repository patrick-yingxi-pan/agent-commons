import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { PersistedState, PersistenceBackend } from './format.ts'
import { fields, publicKey, tokenId, verifiedJws } from '../taskPartners/protocol.ts'
import { partnerOrigins } from '../taskPartners/publicHttp.ts'

/** Full-state fingerprint for an offline operator. Sorting JSON object members
 * makes JSON and SQLite representations equivalent, including the surrounding
 * account, Project permissions and other identity-bearing state. */
export function partnerRestoreDigest(state: PersistedState): string {
  const bytes = JSON.stringify(state, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    )
  })
  return createHash('sha256').update(bytes).digest('hex')
}

function hasRecords(state: PersistedState | null): boolean {
  const registry = state?.taskPartners
  if (
    registry &&
    (registry.rows.length ||
      registry.replays.length ||
      registry.workers.tokens.length ||
      registry.workers.assertions.length)
  )
    return true
  return Object.values(state?.partnerWork ?? {}).some((value) => Array.isArray(value) && value.length > 0)
}

/** A portable file has no authority to select the recovery key or reset a
 * financial journal. The side-channel authorization is provisioned by the
 * operator managing this installation and binds both complete snapshots. */
function verifyAuthorization(
  incoming: PersistedState,
  live: PersistedState | null,
  env: Record<string, string | undefined>,
  now: number,
) {
  const deployment = partnerOrigins(env).webOrigin
  if (!deployment || !env.TASK_PARTNER_RESTORE_PUBLIC_KEY || !env.TASK_PARTNER_RESTORE_AUTHORIZATION)
    throw new Error(
      'Partner restore requires an offline operator authorization for this deployment and a reconciled ledger checkpoint.',
    )
  const key = publicKey(JSON.parse(env.TASK_PARTNER_RESTORE_PUBLIC_KEY))
  const { claims } = verifiedJws(env.TASK_PARTNER_RESTORE_AUTHORIZATION, 'partner-restore+jwt', (kid) =>
    kid === key.kid ? key : undefined,
  )
  fields(claims, ['iss', 'aud', 'jti', 'iat', 'exp', 'snapshotDigest', 'liveDigest', 'reconciliationRef'])
  tokenId(claims.jti)
  const seconds = Math.floor(now / 1000)
  if (
    claims.iss !== 'deployment-operator' ||
    claims.aud !== deployment ||
    typeof claims.iat !== 'number' ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat > seconds ||
    typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= seconds ||
    claims.exp - claims.iat > 300 ||
    claims.snapshotDigest !== partnerRestoreDigest(incoming) ||
    claims.liveDigest !== (live ? partnerRestoreDigest(live) : null) ||
    typeof claims.reconciliationRef !== 'string' ||
    !claims.reconciliationRef.trim() ||
    claims.reconciliationRef.length > 200
  )
    throw new Error(
      'Partner restore authorization is expired or does not match the deployment, backup, live store and reconciliation record.',
    )
}

/** Recover offline only after all writers are stopped. A readable journal
 * always wins over an older or injected snapshot, including after transfers
 * have settled. An empty staging backend (also used to replace damaged SQLite)
 * receives protective holds before it can become the live backend. */
export function prepareTaskPartnerRestoreState(
  incoming: PersistedState,
  backend: Pick<PersistenceBackend, 'load'>,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): PersistedState {
  let live: PersistedState | null
  try {
    live = backend.load()
  } catch (error) {
    if (!env.TASK_PARTNER_WEB_ORIGIN && !hasRecords(incoming)) return incoming
    live = null
  }
  const incomingActivity = hasRecords(incoming),
    liveActivity = hasRecords(live)
  if (!incomingActivity && !liveActivity && (live || !env.TASK_PARTNER_WEB_ORIGIN)) return incoming
  if (liveActivity && live) {
    if (
      !isDeepStrictEqual(incoming.partnerWork, live.partnerWork) ||
      !isDeepStrictEqual(incoming.taskPartners, live.taskPartners)
    )
      throw new Error(
        'Partner restore refused a conflicting journal. Preserve the current partner identities, funds and outstanding effects.',
      )
    if (partnerRestoreDigest(incoming) === partnerRestoreDigest(live)) return incoming
  }
  verifyAuthorization(incoming, live, env, now)
  if (liveActivity) return incoming
  return quarantineDisasterRestore(incoming, now)
}

function quarantineDisasterRestore(incoming: PersistedState, now: number): PersistedState {
  const state = structuredClone(incoming)
  const registry = state.taskPartners
  if (registry) {
    registry.workers.tokens = []
    for (const row of registry.rows) {
      for (const entry of row.domains) entry.contradicted = true
      if (row.app.state === 'active') {
        row.app.state = 'suspended'
        row.app.decisionReason = 'Restored from an offline checkpoint. Review new work after reconciliation.'
        row.app.revision++
        row.history.push({
          eventId: 'restore-' + row.app.revision,
          recordedAt: new Date(now).toISOString(),
          actorRef: 'deployment-operator',
          action: 'disaster_restore',
          revision: row.app.revision,
          reason: row.app.decisionReason,
        })
      }
    }
  }
  const work = state.partnerWork
  if (!work) return state
  work.pins = []
  for (const [, handoff] of work.handoffs) {
    if (['started', 'exchanged', 'attested', 'confirmed'].includes(handoff.view.state)) {
      handoff.view.state = 'withdrawn'
      handoff.startCodeHash = ''
    }
  }
  const tasks = new Map(work.tasks),
    obligations = new Map(work.obligations)
  for (const [, command] of work.commands) {
    const c = command.view
    if (c.state !== 'requested') continue
    const task = tasks.get(c.taskId)
    if (!task) throw new Error('Partner recovery found an orphan command.')
    c.state = 'uncertain'
    const payment = c.action.kind === 'release' || c.action.kind === 'return' || c.action.kind === 'reserve'
    const key = payment ? (task.obligationId ?? c.commandId) : c.commandId
    const existing = obligations.get(key)
    if (existing?.state === 'in_recovery') continue
    if (payment) {
      task.funding = 'uncertain'
      task.obligationId = key
    }
    obligations.set(key, {
      ...existing,
      obligationId: key,
      partnerId: c.partnerId,
      taskId: c.taskId,
      termsVersion: c.termsVersion,
      termsDigest: c.termsDigest,
      revision: (existing?.revision ?? 0) + 1,
      openedAt: existing?.openedAt ?? new Date(now).toISOString(),
      state: 'effect_uncertain',
      commandId: c.commandId,
      ...(payment && 'asset' in c.action && { asset: c.action.asset }),
    })
  }
  work.obligations = [...obligations]
  return state
}
