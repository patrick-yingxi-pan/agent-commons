import { createHash, randomUUID } from 'node:crypto'
import type { PartnerGrant, TaskArtifact, TaskPartnerCommand, TaskVersion } from '../../contract/taskPartnerWork.ts'
import { DEMO_READY_RULE, signDemoPartnerJwt, type DemoPartnerWorker } from '../data/taskPartnerDemo.ts'
import { demoPartnerAudience } from './demoConfiguration.ts'
import type { DemoPartnerLedger } from './demoPartnerLedger.ts'
import type { VerifiedOutcome } from './dispatcher.ts'

export interface DemoGrantOffer extends TaskVersion {
  handoffId: string; partnerId: string; environment: 'production'; actorRef: string; nonce: string
  expiresAt: string; grant: PartnerGrant; workSummary: string
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const encoded = encodeURIComponent

/** The transport is fixed to the local development server. The signed audience
 * remains the one that the enrollment registry and receipt verifier check. */
export class DemoWorkerClient {
  private base: string
  private access?: { token: string; expires: number }
  private ledger: DemoPartnerLedger
  private worker: DemoPartnerWorker
  constructor(worker: DemoPartnerWorker, platformApiOrigin: string, ledger: DemoPartnerLedger) {
    const origin = new URL(platformApiOrigin)
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== platformApiOrigin) throw Error('Demo workers require an exact loopback server origin.')
    this.base = origin.origin + '/api/v1/task-partners/production'
    this.worker = worker
    this.ledger = ledger
  }
  private sign(type: string, claims: object) {
    return signDemoPartnerJwt(this.worker.privateKey, this.worker.kid, type, {
      iss: this.worker.partnerId, aud: demoPartnerAudience('production'), ...claims,
    })
  }
  private async token() {
    if (this.access && Date.now() + 15000 < this.access.expires) return this.access.token
    const iat = Math.floor(Date.now() / 1000)
    const assertion = this.sign('partner-client-auth+jwt', {
      sub: this.worker.partnerId, aud: demoPartnerAudience('production') + '/oauth/token', iat, exp: iat + 120, jti: randomUUID(),
    })
    const scopes = ['commands:read', 'handoffs:write', 'receipts:write', 'artifacts:read']
    if (this.worker.catalog.models.length) scopes.push('artifacts:write')
    const response = await fetch(this.base + '/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.worker.partnerId,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion, scope: scopes.join(' ') }),
    })
    if (!response.ok) throw Error('Demo partner credentials are unavailable (' + response.status + ').')
    const token = await response.json() as { access_token: string; expires_in: number }
    this.access = { token: token.access_token, expires: Date.now() + token.expires_in * 1000 }
    return this.access.token
  }
  private async request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', 'Bearer ' + await this.token())
    const response = await fetch(this.base + path, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      if (response.status === 401) this.access = undefined
      throw Error('Demo partner operation failed (' + response.status + ').')
    }
    return response
  }
  private post(path: string, key: string, body: unknown) {
    return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
  }
  async exchange(handoffId: string, startCode: string): Promise<DemoGrantOffer> {
    const res = await this.post('/handoffs/' + encoded(handoffId) + '/exchange', 'demo-exchange-' + handoffId, { startCode })
    const offer = await res.json() as DemoGrantOffer
    if (offer.partnerId !== this.worker.partnerId || offer.handoffId !== handoffId || offer.environment !== 'production') throw Error('Demo grant binding mismatch.')
    return offer
  }
  async select(offer: DemoGrantOffer, ending: '19' | '42') {
    const { handoffId, actorRef, nonce, grant, taskId, termsVersion, termsDigest } = offer
    const grantRef = 'demo-' + handoffId + '-' + ending
    const exp = Math.floor(Date.parse(offer.expiresAt) / 1000)
    const claims = { taskId, termsVersion, termsDigest, environment: 'production', handoffId, actorRef, nonce, grant,
      grantRef, accountLabel: 'Demo account ending in ' + ending, jti: handoffId, exp }
    const signedGrant = await this.ledger.signOnce(this.worker.partnerId, 'handoff', handoffId, claims, () => {
      const iat = Math.floor(Date.now() / 1000)
      if (!Number.isSafeInteger(exp) || iat >= exp) throw Error('Demo grant has expired.')
      return this.sign('partner-handoff+jwt', { ...claims, iat })
    })
    // Persist the authorized fixture account before acknowledgement can trigger dispatch.
    this.ledger.bindAccount(this.worker.partnerId, grantRef, actorRef, ending, grant)
    await this.post('/handoffs/' + encoded(handoffId) + '/attestations', 'demo-attest-' + handoffId, { signedGrant })
  }
  private async input(commandId: string, ref: TaskArtifact) {
    const res = await this.request('/commands/' + encoded(commandId) + '/artifacts/' + encoded(ref.artifactId))
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (digest(bytes) !== ref.digest) throw Error('Demo input digest mismatch.')
    return bytes
  }
  private async outcome(command: TaskPartnerCommand): Promise<VerifiedOutcome> {
    const { action, commandId, partnerId } = command
    if (action.kind === 'verify') {
      const { rule } = action
      const match = rule.ruleId === DEMO_READY_RULE.ruleId && rule.version === DEMO_READY_RULE.version && rule.digest === DEMO_READY_RULE.digest
      if (!match) return { kind: 'failed', actionKind: 'verify', reasonCode: 'unsupported_demo_rule' }
      const bytes = await this.input(commandId, action.submission)
      const passed = digest(bytes) === digest(Buffer.from('ready'))
      return { kind: 'verify', submissionId: action.submissionId, submissionDigest: action.submission.digest,
        rule, verdict: passed ? 'passed' : 'rejected', detailCode: passed ? 'exact_ready' : 'expected_ready' }
    }
    if (action.kind !== 'run') return this.ledger.settle(partnerId, commandId, action)
    if (!this.ledger.permitsRun(partnerId, action) || action.model !== 'orchard-demo' || (action.effort && action.effort !== 'standard'))
      return { kind: 'failed', actionKind: 'run', reasonCode: 'demo_grant_mismatch' }
    await this.input(commandId, action.input)
    // The fictional model always emits one deterministic, verifiable result.
    const output = Buffer.from('ready')
    const uploaded = await this.request('/commands/' + encoded(commandId) + '/artifacts', { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Artifact-Media-Type': 'text/plain',
        'Content-Digest': 'sha-256=:' + createHash('sha256').update(output).digest('base64') + ':', 'Idempotency-Key': 'demo-output-' + commandId }, body: output as BodyInit })
    const artifact = await uploaded.json() as TaskArtifact
    if (artifact.digest !== digest(output)) throw Error('Demo output digest mismatch.')
    return { kind: 'run', providerRunId: 'demo-' + commandId, submissionId: action.submissionId,
      grantRef: action.grantRef, actualModel: action.model, ...(action.effort && { actualEffort: action.effort }),
      inputDigest: action.input.digest, output: artifact }
  }
  private async process(command: TaskPartnerCommand) {
    if (command.environment !== 'production' || command.partnerId !== this.worker.partnerId || command.state !== 'requested') return
    const { taskId, termsVersion, termsDigest, commandId } = command
    const intent = { taskId, termsVersion, termsDigest, action: command.action }
    const signedReceipt = await this.ledger.signOnce(this.worker.partnerId, 'receipt', commandId, intent, async () => {
      const outcome = await this.outcome(command)
      return this.sign('partner-receipt+jwt', { taskId, termsVersion, termsDigest, commandId, outcome,
        iat: Math.floor(Date.now() / 1000), jti: commandId, environment: 'production' })
    })
    await this.post('/commands/' + encoded(commandId) + '/receipts', 'demo-receipt-' + commandId, { signedReceipt })
  }
  async poll() {
    let failed = false
    let cursor: string | undefined
    do {
      const response = await this.request('/commands?limit=100' + (cursor ? '&cursor=' + encoded(cursor) : ''))
      const page = await response.json() as { items: TaskPartnerCommand[]; nextCursor?: string }
      for (const command of page.items) {
        // One expired command or missing artifact must not starve unrelated tasks.
        try { await this.process(command) } catch { failed = true }
      }
      cursor = page.nextCursor
    } while (cursor)
    if (failed) throw Error('One or more demo commands need a retry.')
  }
}
