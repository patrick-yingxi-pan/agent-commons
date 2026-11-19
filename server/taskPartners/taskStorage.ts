import type {
  FrozenTaskPartner,
  PartnerTaskView,
  PartnerTaskTerms,
  PartnerSubmission,
  TaskAsset,
  TaskArtifact,
  TaskHandoff,
  TaskPartnerCommand,
  TaskVersion,
} from '../../contract/taskPartnerWork.ts'
import type { PartnerIdentity } from '../../contract/taskPartners.ts'
import { hash, parseTerms, type StoredArtifact } from './taskTerms.ts'
import { SITE_CUSTODIAN_ID, SITE_WORK_CREDIT } from '../../contract/taskPartnerWork.ts'
import { isDeepStrictEqual } from 'node:util'
import { fail } from './protocol.ts'
import type { StoredWorkItemComment } from '../persistence/format.ts'

export interface WorkTask {
  taskId: string
  projectId: string
  owner: string
  author: { tenantId: string; userId: string }
  postedAs?: string
  comments: StoredWorkItemComment[]
  termsVersion: number
  termsDigest: string
  terms: PartnerTaskTerms
  status: PartnerTaskView['status']
  funding: PartnerTaskView['funding']
  submissions: WorkSubmission[]
  createdAt: string
  publishedAt?: string
  claimant?: string
  winnerId?: string
  reserveCommand?: string
  reservationId?: string
  payoutCommand?: string
  obligationId?: string
  input: TaskArtifact
  pinned: Record<string, Omit<FrozenTaskPartner, 'status'>>
  previousOffer?: TaskVersion
  priorTerms: { termsVersion: number; termsDigest: string; terms: PartnerTaskTerms }[]
}
export interface WorkSubmission extends Omit<PartnerSubmission, 'mine'> {
  author: string
  artifact?: TaskArtifact
}
export interface WorkHandoff {
  view: TaskHandoff
  owner: string
  startCodeHash: string
  nonce: string
  startUrl: string
  partnerActor: string
  actor: { tenantId: string; userId: string }
  signedGrant?: string
  grantRef?: string
  keyId?: string
}
export interface WorkCommand {
  view: TaskPartnerCommand
  owner?: string
  handoffId?: string
  settlementHold?: string
}
export interface WorkObligation {
  obligationId: string
  partnerId: string
  taskId: string
  termsVersion: number
  termsDigest: string
  revision: number
  openedAt: string
  state: 'held' | 'effect_uncertain' | 'settlement_pending' | 'in_recovery' | 'closed'
  commandId: string
  reservationId?: string
  asset?: TaskAsset
  latestRecoveryId?: string
}
export interface WorkRecovery {
  recoveryId: string
  obligationId: string
  commandId: string
  revision: number
  state: 'opened' | 'authorized' | 'evidence_recorded' | 'reconciled'
  mode: 'lookup' | 'release' | 'return'
  reason: string
  evidenceDigest?: string
  opener: string
  authorizer?: string
  submitter?: string
  sourceReference?: string
  externalEvidence?: string
  keyId?: string
}
export interface StoredReceipt {
  commandId: string
  receiptId: string
  keyId: string
  signedReceipt: string
  state: 'uncertain' | 'succeeded' | 'failed'
}
interface Records {
  tasks: WorkTask
  handoffs: WorkHandoff
  commands: WorkCommand
  artifacts: StoredArtifact
  pins: Pick<PartnerIdentity, 'domainAscii' | 'identityRevision'>
  receipts: StoredReceipt
  used: string
  obligations: WorkObligation
  recoveries: WorkRecovery
  creditEntries: {
    reference: string
    kind: 'issue' | 'reserve' | 'release' | 'return'
    account: string
    amount: string
    at: string
    issuer?: string
    reason?: string
    taskId?: string
    source?: string
    termsVersion?: number
    termsDigest?: string
  }
}
type Tables = { [K in keyof Records]: Map<string, Records[K]> }
export type PartnerWorkSnapshot = { version: 1 } & { [K in keyof Records]: [string, Records[K]][] }
const tables = [
  'tasks',
  'handoffs',
  'commands',
  'artifacts',
  'pins',
  'receipts',
  'used',
  'obligations',
  'recoveries',
  'creditEntries',
] as const

/** Mutations use record-level before-images. With opaque blobs this avoids
 * cloning every partner's artifact whenever one unrelated draft changes. */
export class WorkStorage {
  private rows = Object.fromEntries(tables.map((k) => [k, new Map()])) as Tables
  private undo?: Map<string, () => void>
  private editedTasks?: Map<string, WorkTask | undefined>
  private changed: () => void
  private onTask?: (task: WorkTask, before?: WorkTask) => void
  constructor(changed: () => void, onTask?: (task: WorkTask, before?: WorkTask) => void) {
    this.changed = changed
    this.onTask = onTask
  }
  get<K extends keyof Records>(table: K, key: string): Records[K] | undefined {
    return this.rows[table].get(key)
  }
  all<K extends keyof Records>(table: K): Records[K][] {
    return [...this.rows[table].values()]
  }
  put<K extends keyof Records>(table: K, key: string, value: Records[K]) {
    if (!this.undo) throw new Error('Partner write requires a transaction.')
    const token = table + ':' + key,
      map = this.rows[table]
    if (!this.undo.has(token)) {
      const old = map.get(key)
      if (table === 'tasks') this.editedTasks!.set(key, old as WorkTask | undefined)
      this.undo.set(token, () => {
        if (old === undefined) map.delete(key)
        else map.set(key, old)
      })
    }
    map.set(key, value)
  }
  edit<K extends keyof Records>(table: K, key: string): Records[K] {
    const old = this.get(table, key)
    if (!old) return fail(404, 'not_found', 'This item is unavailable.')
    const working = structuredClone(old)
    this.put(table, key, working)
    return working
  }
  remove<K extends keyof Records>(table: K, key: string) {
    const prior = this.get(table, key)
    if (prior === undefined) return
    this.put(table, key, prior)
    this.rows[table].delete(key)
  }
  transaction<T>(run: () => T): T {
    if (this.undo) throw new Error('Nested partner transaction.')
    this.undo = new Map()
    this.editedTasks = new Map()
    try {
      const result = run()
      if (this.onTask)
        for (const [key, before] of this.editedTasks) {
          const task = this.get('tasks', key)
          if (task?.publishedAt) this.onTask(task, before)
        }
      if (this.undo.size) this.changed()
      return structuredClone(result)
    } catch (error) {
      for (const rollback of [...this.undo.values()].reverse()) rollback()
      throw error
    } finally {
      this.undo = undefined
      this.editedTasks = undefined
    }
  }
  snapshot(): PartnerWorkSnapshot {
    return structuredClone({
      version: 1,
      ...Object.fromEntries(tables.map((k) => [k, [...this.rows[k]]])),
    }) as PartnerWorkSnapshot
  }
  restore(raw: unknown) {
    if (raw === undefined) {
      // An older workspace has no partner journal. Rehydration replaces the
      // in-memory workspace, including any records from its previous image.
      for (const table of tables) this.rows[table].clear()
      return
    }
    const snapshot = raw as PartnerWorkSnapshot
    if (!snapshot || snapshot.version !== 1 || !tables.every((k) => Array.isArray(snapshot[k])))
      throw new Error('Unrecognized partner work snapshot.')
    const restored = Object.fromEntries(
      tables.map((k) => {
        const table = new Map<string, unknown>()
        for (const [key, value] of structuredClone(snapshot[k])) {
          if (typeof key !== 'string' || value === undefined || table.has(key))
            throw new Error('Invalid partner work record.')
          table.set(key, value)
        }
        return [k, table]
      }),
    ) as Tables
    checkRestoredState(restored)
    this.rows = restored
  }
}
function checkRestoredState(data: Tables) {
  function check(condition: unknown): asserts condition {
    if (!condition) throw new Error('Inconsistent partner work journal.')
  }
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  for (const [key, a] of data.artifacts) {
    check(a.ref && a.ref.artifactId === key && typeof a.bytes === 'string' && a.bytes.length <= 11_184_812)
    const bytes = Buffer.from(a.bytes, 'base64')
    check(
      bytes.toString('base64') === a.bytes &&
        hash(bytes) === a.ref.digest &&
        key === 'artifact-' + hash(JSON.stringify([a.uploadedFor ?? 'task-input', a.ref.mediaType, a.ref.digest])),
    )
    if (a.uploadedFor) check(data.commands.get(a.uploadedFor)?.view.action.kind === 'run')
  }
  for (const [key, t] of data.tasks) {
    check(
      t.taskId === key &&
        /^task-[0-9a-f]{32}$/.test(key) &&
        typeof t.projectId === 'string' &&
        /^actor-[0-9a-f]{64}$/.test(t.owner),
    )
    check(
      t.author &&
        t.owner === 'actor-' + hash(JSON.stringify([t.author.tenantId, t.author.userId])) &&
        Array.isArray(t.comments) &&
        t.comments.length <= 100,
    )
    for (const c of t.comments)
      check(
        typeof c.id === 'string' &&
          typeof c.author === 'string' &&
          typeof c.body === 'string' &&
          c.body.length <= 2000 &&
          Number.isSafeInteger(c.at),
      )
    check(new Set(t.comments.map((c) => c.id)).size === t.comments.length)
    if (t.publishedAt) check(typeof t.postedAs === 'string' && t.postedAs.length > 0)
    check(
      Number.isSafeInteger(t.termsVersion) &&
        t.termsVersion >= 1 &&
        timestamp(t.createdAt) &&
        Array.isArray(t.submissions) &&
        t.pinned,
    )
    const terms = parseTerms(t.terms, Date.parse(t.createdAt) - 1)
    check(isDeepStrictEqual(terms, t.terms) && t.termsDigest === hash(JSON.stringify([key, t.termsVersion, terms])))
    const firstVersion = (t.previousOffer?.termsVersion ?? 0) + 1
    if (t.previousOffer) {
      const prior = data.tasks.get(t.previousOffer.taskId)
      check(
        prior &&
          prior.publishedAt &&
          prior.owner === t.owner &&
          prior.projectId === t.projectId &&
          prior.termsVersion === t.previousOffer.termsVersion &&
          prior.termsDigest === t.previousOffer.termsDigest,
      )
    }
    check(Array.isArray(t.priorTerms) && t.priorTerms.length === t.termsVersion - firstVersion)
    for (const [index, v] of t.priorTerms.entries())
      check(
        v.termsVersion === index + firstVersion &&
          v.termsDigest === hash(JSON.stringify([key, v.termsVersion, v.terms])),
      )
    check(isDeepStrictEqual(data.artifacts.get(t.input.artifactId)?.ref, t.input))
    check(
      ['draft', 'published', 'closed', 'cancelled'].includes(t.status) &&
        [
          'volunteer',
          'awaiting',
          'reserving',
          'held',
          'delivering',
          'delivered',
          'returning',
          'returned',
          'uncertain',
        ].includes(t.funding),
    )
    check(t.terms.reward ? t.funding !== 'volunteer' : t.funding === 'volunteer')
    check(new Set(t.submissions.map((s) => s.submissionId)).size === t.submissions.length)
    if (t.winnerId)
      check(
        t.status === 'closed' &&
          t.submissions.some(
            (s) =>
              s.submissionId === t.winnerId &&
              s.verdict === 'passed' &&
              (!t.terms.provenance || s.provenance === 'attested'),
          ),
      )
    for (const s of t.submissions) {
      check(
        typeof s.author === 'string' &&
          timestamp(s.submittedAt) &&
          ['open', 'pending', 'passed', 'rejected', 'unavailable'].includes(s.verdict),
      )
      check(['optional', 'pending', 'attested', 'failed'].includes(s.provenance))
      if (s.artifact)
        check(
          isDeepStrictEqual(s.artifact, data.artifacts.get(s.artifact.artifactId)?.ref) &&
            s.digest === s.artifact.digest,
        )
    }
    if (t.reserveCommand)
      check(
        data.commands.get(t.reserveCommand)?.view.taskId === key &&
          data.commands.get(t.reserveCommand)?.view.action.kind === 'reserve',
      )
    if (t.payoutCommand)
      check(
        data.commands.get(t.payoutCommand)?.view.taskId === key &&
          ['release', 'return'].includes(data.commands.get(t.payoutCommand)!.view.action.kind),
      )
    if (t.obligationId) check(data.obligations.get(t.obligationId)?.taskId === key)
    if (['held', 'returning', 'returned', 'delivering', 'delivered'].includes(t.funding))
      check(t.reserveCommand && t.reservationId && t.obligationId)
  }
  for (const [key, c] of data.commands) {
    const v = c.view,
      task = data.tasks.get(v.taskId)
    check(
      key === v.commandId &&
        task &&
        [task, ...task.priorTerms].some((t) => t.termsVersion === v.termsVersion && t.termsDigest === v.termsDigest) &&
        v.environment === 'production' &&
        timestamp(v.issuedAt) &&
        timestamp(v.deadline),
    )
    check(
      ['requested', 'uncertain', 'succeeded', 'failed'].includes(v.state) &&
        ['reserve', 'run', 'verify', 'release', 'return'].includes(v.action.kind),
    )
    if (c.handoffId) check(data.handoffs.get(c.handoffId)?.view.partnerId === v.partnerId)
    if (v.receiptId && v.partnerId !== SITE_CUSTODIAN_ID)
      check(data.receipts.get(JSON.stringify([v.partnerId, v.receiptId]))?.commandId === key)
  }
  for (const [key, h] of data.handoffs) {
    const task = data.tasks.get(h.view.taskId)
    check(key === h.view.handoffId && task && h.view.termsVersion <= task.termsVersion && timestamp(h.view.expiresAt))
    check(
      h.actor &&
        h.actor.tenantId &&
        h.actor.userId &&
        h.owner === 'actor-' + hash(JSON.stringify([h.actor.tenantId, h.actor.userId])),
    )
    check(typeof h.partnerActor === 'string' && /^subject-[0-9a-f]{32}$/.test(h.partnerActor))
    check(
      ['started', 'exchanged', 'attested', 'confirmed', 'declined', 'expired', 'withdrawn', 'consumed'].includes(
        h.view.state,
      ),
    )
  }
  for (const [key, o] of data.obligations)
    check(key === o.obligationId && data.commands.get(o.commandId)?.view.taskId === o.taskId)
  for (const [key, r] of data.recoveries)
    check(key === r.recoveryId && data.obligations.has(r.obligationId) && data.commands.has(r.commandId))
  for (const [key, r] of data.receipts) {
    const cmd = data.commands.get(r.commandId)
    check(
      cmd &&
        key === JSON.stringify([cmd.view.partnerId, r.receiptId]) &&
        typeof r.signedReceipt === 'string' &&
        data.used.get(JSON.stringify([cmd.view.partnerId, 'signed:' + hash(r.signedReceipt)])) === key,
    )
  }
  const available = new Map<string, bigint>(),
    held = new Map<string, bigint>()
  const change = (map: Map<string, bigint>, key: string, delta: bigint) => {
    const next = (map.get(key) ?? 0n) + delta
    check(next >= 0n)
    map.set(key, next)
  }
  for (const [key, e] of data.creditEntries) {
    check(
      e.reference === key &&
        timestamp(e.at) &&
        /^[1-9][0-9]{0,37}$/.test(e.amount) &&
        /^actor-[0-9a-f]{64}$/.test(e.account),
    )
    const n = BigInt(e.amount)
    if (e.kind === 'issue') {
      check(key.startsWith('issue:') && e.issuer && e.reason)
      change(available, e.account, n)
    } else {
      const cmd = data.commands.get(key)?.view,
        t = data.tasks.get(e.taskId!)
      check(
        cmd &&
          t &&
          cmd.action.kind === e.kind &&
          cmd.partnerId === SITE_CUSTODIAN_ID &&
          cmd.state === 'succeeded' &&
          cmd.termsDigest === e.termsDigest &&
          cmd.termsVersion === e.termsVersion &&
          cmd.action.asset.quantity === e.amount &&
          cmd.action.asset.assetId === SITE_WORK_CREDIT.assetId &&
          cmd.action.asset.unit === SITE_WORK_CREDIT.unit,
      )
      if (e.kind === 'reserve') {
        check(e.account === t.owner && t.reserveCommand === key)
        change(available, e.account, -n)
        change(held, e.account, n)
      } else {
        check(e.source === t.owner && t.payoutCommand === key)
        change(held, e.source, -n)
        change(available, e.account, n)
      }
    }
  }
}
