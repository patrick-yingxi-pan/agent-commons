import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import type { PartnerGrant, TaskAsset, TaskPartnerCommand } from '../../contract/taskPartnerWork.ts'
import type { VerifiedOutcome } from './dispatcher.ts'

type WalletGrant = { actor: string; wallet: string; grant: PartnerGrant }
type Hold = { wallet: string; payerRef: string; asset: TaskAsset; state: 'held' | 'released' | 'returned' }
type SignedEvidence = { intent: object; jwt: string }
type CustodyAction = Extract<TaskPartnerCommand['action'], {kind: 'reserve' | 'return' | 'release'}>
type Statement = { run(...args: string[]): unknown; get(...args: string[]): { value: string } | undefined }
type Database = { prepare(sql: string): Statement; exec(sql: string): void; close(): void }
const sameAsset = (a: TaskAsset, b: TaskAsset) => a.assetId === b.assetId && a.unit === b.unit && a.quantity === b.quantity

/** The fictional custodian keeps its own records across platform retries and restarts. */
export class DemoPartnerLedger {
  private db: Database
  constructor(path = ':memory:') {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new(path: string) => Database }
    this.db = new DatabaseSync(path)
    this.db.exec('CREATE TABLE IF NOT EXISTS demo_partner_accounts (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  }
  close() { this.db.close() }
  private read<T>(bucket: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM demo_partner_accounts WHERE id = ?').get(bucket + '/' + id)
    return row ? JSON.parse(row.value) as T : undefined
  }
  private write(bucket: string, id: string, data: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO demo_partner_accounts(id, value) VALUES (?, ?)').run(bucket + '/' + id, JSON.stringify(data))
  }
  async signOnce(partner: string, kind: 'handoff' | 'receipt', id: string, intent: object, issue: () => string | Promise<string>) {
    const bucket = 'signature-' + kind
    const key = partner + '/' + id
    let stored = this.read<SignedEvidence>(bucket, key)
    if (!stored) {
      const jwt = await issue()
      // Two workers may complete the same idempotent operation before either posts its receipt.
      this.db.prepare('INSERT INTO demo_partner_accounts(id, value) VALUES (?, ?) ON CONFLICT(id) DO NOTHING')
        .run(bucket + '/' + key, JSON.stringify({ intent, jwt } satisfies SignedEvidence))
      stored = this.read<SignedEvidence>(bucket, key)
    }
    if (!stored || !isDeepStrictEqual(stored.intent, intent)) throw Error('Demo signature intent changed.')
    return stored.jwt
  }
  bindAccount(partner: string, grantRef: string, actor: string, ending: string, grant: PartnerGrant) {
    // Actor references are deliberately different on every handoff. The
    // fictional account chosen at the custodian has a stable balance.
    const wallet = JSON.stringify([partner, ending])
    this.write('grant', partner + '/' + grantRef, { actor, wallet, grant } satisfies WalletGrant)
  }
  permitsRun(partner: string, action: Extract<TaskPartnerCommand['action'], { kind: 'run' }>) {
    const saved = this.read<WalletGrant>('grant', partner + '/' + action.grantRef)?.grant
    return saved?.kind === 'run' && saved.model === action.model && saved.effort === action.effort &&
      saved.inputDigest === action.input.digest && saved.maxInputTokens === action.maxInputTokens && saved.maxOutputTokens === action.maxOutputTokens
  }
  private balance(wallet: string) { return BigInt(this.read<string>('balance', wallet) ?? '100') }
  settle(partner: string, commandId: string, action: CustodyAction): VerifiedOutcome {
    const key = partner + '/' + commandId
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.read<VerifiedOutcome>('effect', key)
      const outcome = previous ?? this.move(partner, commandId, action)
      if (!previous) this.write('effect', key, outcome)
      this.db.exec('COMMIT')
      return outcome
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private move(partner: string, commandId: string, action: CustodyAction): VerifiedOutcome {
    const failed = (reasonCode: string): VerifiedOutcome => ({ kind: 'failed', actionKind: action.kind, reasonCode })
    const amount = BigInt(action.asset.quantity)
    if (action.asset.assetId !== 'review-voucher' || action.asset.unit !== 'voucher' || amount <= 0n) return failed('unsupported_demo_asset')
    if (action.kind === 'reserve') {
      const account = this.read<WalletGrant>('grant', partner + '/' + action.grantRef)
      if (!account || account.actor !== action.payerRef || account.grant.kind !== 'reserve' ||
        !sameAsset(account.grant.asset, action.asset) || account.grant.holdUntil !== action.holdUntil) return failed('demo_grant_mismatch')
      const balance = this.balance(account.wallet)
      if (balance < amount) return failed('insufficient_demo_vouchers')
      this.write('balance', account.wallet, String(balance - amount))
      const reservationId = 'demo-' + commandId
      this.write('hold', partner + '/' + reservationId, { wallet: account.wallet, payerRef: action.payerRef, asset: action.asset, state: 'held' } satisfies Hold)
      return { ...action, reservationId }
    }
    const key = partner + '/' + action.reservationId
    const held = this.read<Hold>('hold', key)
    if (!held || held.state !== 'held' || !sameAsset(held.asset, action.asset)) return failed('demo_hold_unavailable')
    let wallet = held.wallet
    if (action.kind === 'release') {
      const receiver = this.read<WalletGrant>('grant', partner + '/' + action.grantRef)
      if (!receiver || receiver.actor !== action.beneficiaryRef || receiver.grant.kind !== 'receive' ||
        !sameAsset(receiver.grant.asset, action.asset)) return failed('demo_grant_mismatch')
      wallet = receiver.wallet
    } else if (held.payerRef !== action.payerRef) return failed('demo_payer_mismatch')
    this.write('balance', wallet, String(this.balance(wallet) + amount))
    this.write('hold', key, { ...held, state: action.kind === 'release' ? 'released' : 'returned' })
    return { ...action, transferRef: 'demo-' + commandId }
  }
}
