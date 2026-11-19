import { randomBytes } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import type { PartnerApplication, PartnerAuditEntry, PartnerCapability, PartnerCatalogEntry, PartnerDomainChallenge,
  PartnerDomainPurpose, PartnerEnvironment, PartnerPublicKey, PartnerPublicProfile } from '../../contract/taskPartners.ts'
import { partnerCapabilities } from '../../contract/taskPartners.ts'
import { enrollment, capabilities, partnerDisplayName } from './enrollment.ts'
import { PartnerNameIndex, partnerWebsite } from './identity.ts'
import { catalogDigest, day, fail, fields, id, identifier, iso, label, PartnerRegistryError, positive,
  publicKey, record, sha256, thumbprint, tokenId, verifiedJws } from './protocol.ts'
import { beginConformance, applyFixtureReceipt, expireConformance, observeReceiptReplay, type SandboxReport } from './conformance.ts'
import { PartnerWorkerTokens } from './workerTokens.ts'
import { validateEnrollmentRow } from './validateSnapshot.ts'
import { deploymentVerifierSamples, type VerifierSamples } from './verifierSamples.ts'
export { PartnerRegistryError } from './protocol.ts'

export interface PartnerActor { userId: string; tenantId: string; operator: boolean; organizationAdmin: boolean; freshAuth?: boolean }
export interface PartnerRegistryOptions {
  now?: () => number
  resolveTxt?: (name: string) => Promise<string[][]>
  audience?: (environment: PartnerEnvironment) => string
  changed?: () => void
  verifierSamples?: VerifierSamples
}
interface DomainRecord {
  challenge: PartnerDomainChallenge; url: string; verifiedAt?: number; observedAt?: number
  contradicted?: boolean
}
export interface PartnerEnrollmentRow {
  app: PartnerApplication; owner: { userId: string; tenantId: string }
  keyMaterial: PartnerPublicKey[]; domains: DomainRecord[]; published: boolean; identityRevision: number
  bindings: Partial<Record<PartnerDomainPurpose, string>>; reports: SandboxReport[]
  sandboxReportId?: string; history: PartnerAuditEntry[]
}
interface Replay { key: string; digest: string; until: number; response: unknown }
export interface PartnerRegistrySnapshot {
  version: 1; rows: PartnerEnrollmentRow[]; replays: Replay[]; workers: ReturnType<PartnerWorkerTokens['snapshot']>
}
const dns = new Resolver({ timeout: 3_000, tries: 2 })
const dnsPurposes = ['website', 'handoff'] as const
const domainUntil = (d: DomainRecord) => Math.min((d.verifiedAt ?? 0) + 30 * day, (d.observedAt ?? 0) + day)
const missing = (): never => fail(404, 'not_found', 'Task partner record unavailable.')
const conflict = (message: string): never => fail(409, 'conflict', message)
const inactive = (): never => fail(409, 'identity_inactive', 'Current partner authority is unavailable.')

export class PartnerRegistry {
  private rows = new Map<string, PartnerEnrollmentRow>()
  private nameIndex?: PartnerNameIndex
  private replays = new Map<string, Replay>()
  private workers = new PartnerWorkerTokens()
  private readonly changed: () => void
  private readonly now: () => number
  private readonly resolveTxt: NonNullable<PartnerRegistryOptions['resolveTxt']>
  private readonly audience: NonNullable<PartnerRegistryOptions['audience']>
  private readonly verifierSamples: VerifierSamples
  constructor(options: PartnerRegistryOptions = {}) {
    this.now = options.now ?? Date.now
    this.resolveTxt = options.resolveTxt ?? (name => dns.resolveTxt(name))
    this.changed = options.changed ?? (() => {})
    this.verifierSamples = options.verifierSamples ?? deploymentVerifierSamples
    this.audience = options.audience ?? (()=>fail(503,'integration_unavailable','Configure the partner API origin for this environment.'))
  }
  snapshot(): PartnerRegistrySnapshot {
    return structuredClone({ version: 1, rows: [...this.rows.values()], workers: this.workers.snapshot(),
      replays: [...this.replays.values()].filter(r => r.until > this.now()) })
  }
  restore(state: PartnerRegistrySnapshot | undefined) {
    if (state !== undefined && (state.version !== 1 || !Array.isArray(state.rows) || !Array.isArray(state.replays)))
      throw new Error('Invalid persisted task-partner registry.')
    const rows = new Map<string, PartnerEnrollmentRow>(), replays = new Map<string, Replay>(), ids = new Set<string>(), hosts=new Set<string>()
    const keys=new Set<string>(), reports=new Map<string,{tenantId:string;digest:string}>()
    for (const row of structuredClone(state?.rows ?? [])) {
      const a = row.app
      validateEnrollmentRow(row)
      if (rows.has(a.applicationId) || ids.has(a.partnerId)) throw new Error('Duplicate persisted task partner.')
      for (const key of row.keyMaterial) {
        if (keys.has(key.x)) throw new Error('Duplicate persisted partner key.')
        keys.add(key.x)
      }
      for (const report of row.reports) {
        if (reports.has(report.public.reportId)) throw new Error('Duplicate persisted conformance report.')
        reports.set(report.public.reportId,{tenantId:row.owner.tenantId,digest:report.public.catalogDigest})
      }
      if (row.published && a.state !== 'revoked') {
        const host=new URL(a.organizationUrl).hostname
        if (hosts.has(host)) throw new Error('Duplicate persisted task-partner primary domain.')
        hosts.add(host)
      }
      ids.add(a.partnerId)
      rows.set(a.applicationId, row)
    }
    for (const replay of structuredClone(state?.replays ?? [])) {
      if (typeof replay.key !== 'string' || !/^[0-9a-f]{64}$/.test(replay.digest) || !Number.isSafeInteger(replay.until))
        throw new Error('Invalid persisted task-partner retry receipt.')
      if (replay.until > this.now()) replays.set(replay.key, replay)
    }
    const partners=new Map([...rows.values()].map(row=>[row.app.partnerId,row]))
    for (const row of rows.values()) {
      if (row.app.environment!=='production') continue
      const source=reports.get(row.sandboxReportId!)
      if (!source || source.tenantId!==row.owner.tenantId || source.digest!==catalogDigest(row.app.catalog))
        throw new Error('Invalid persisted sandbox report binding.')
    }
    this.workers.restore(state?.workers,(env,pid,kid)=>{
      const row=partners.get(pid)
      return row?.app.environment===env && row.app.keys.some(k=>k.kid===kid)
    })
    this.rows = rows
    this.nameIndex = undefined
    this.replays = replays
  }
  private row(actor: PartnerActor, env: PartnerEnvironment, appId: string, ownerOnly = false) {
    const row = this.rows.get(appId)
    if (!row || row.app.environment !== env || (!(actor.operator && !ownerOnly) &&
        (!actor.organizationAdmin || row.owner.tenantId !== actor.tenantId))) return missing()
    return row
  }
  private byPartner(env: PartnerEnvironment, partnerId: string) {
    return [...this.rows.values()].find(r => r.app.partnerId === partnerId && r.app.environment === env) ?? missing()
  }
  private note(row: PartnerEnrollmentRow, who: string, action: string, reason?: string, reference?: string) {
    if (row.published && (action.startsWith('decision_') || action === 'domain_verified' || action === 'renamed')) this.nameIndex = undefined
    row.app.revision++
    row.history.push({ eventId: id('event'), actorRef: who, recordedAt: iso(this.now()), action,
      revision: row.app.revision, ...(reason ? { reason } : {}), ...(reference ? { reference } : {}) })
    this.changed()
  }
  private revision(row: PartnerEnrollmentRow, value: unknown) {
    if (positive(value) !== row.app.revision) conflict('The application changed. Refresh and try again.')
  }
  private live(row: PartnerEnrollmentRow, purpose: PartnerDomainPurpose) {
    return row.domains.find(d => d.challenge.challengeId === row.bindings[purpose])
  }
  private proved(row: PartnerEnrollmentRow) {
    const now=this.now()
    return dnsPurposes.every(purpose => {
      const d = this.live(row, purpose)
      return d && !d.contradicted && d.verifiedAt!==undefined && d.observedAt!==undefined &&
        d.observedAt<=now && d.verifiedAt<=now && domainUntil(d)>now
    }) && row.app.keys.some(k => k.state === 'active' && this.key(row,k.kid))
  }
  private phase(row: PartnerEnrollmentRow) {
    if (row.app.state === 'awaiting_proof' && this.proved(row))
      row.app.state = row.app.environment === 'sandbox' ? 'sandbox_testing' : 'in_review'
  }
  private key(row: PartnerEnrollmentRow, kid: string, candidate = false) {
    const entry = row.app.keys.find(k => k.kid === kid)
    if (!entry || Date.parse(entry.validFrom)>this.now() || !(candidate ? entry.state === 'candidate' :
        entry.state === 'active' || entry.state === 'retiring' && Date.parse(entry.validUntil ?? '') > this.now())) return undefined
    return row.keyMaterial.find(k => k.kid === kid)
  }
  private challenge(row: PartnerEnrollmentRow, key: PartnerPublicKey) {
    row.app.challenge = { applicationId: row.app.applicationId, kid: key.kid, nonce: 'n' + randomBytes(32).toString('hex'),
      audience: this.audience(row.app.environment) + '/applications/' + row.app.applicationId + '/proofs',
      expiresAt: iso(this.now() + 300_000) }
  }
  apply(actor: PartnerActor, env: PartnerEnvironment, input: unknown) {
    if (!actor.userId || !actor.tenantId || !['sandbox','production'].includes(env)) return missing()
    if (!actor.organizationAdmin) return fail(403, 'forbidden', 'An organization administrator must open the application.')
    const req = enrollment(input)
    if ([...this.rows.values()].some(row=>row.keyMaterial.some(k=>k.x === req.publicKey.x)))
      conflict('Use a separate signing key for each enrollment and environment.')
    if (env === 'sandbox' && req.sandboxReportId) fail(400, 'bad_request', 'Sandbox applications do not reference an earlier report.')
    if (env === 'production' && !this.qualified(actor, req.sandboxReportId, req.catalog, req.capabilities,
      req.organizationUrl, req.publicKey)) conflict('A current passing report for this organization and catalog and a separate production key are required.')
    if ([...this.rows.values()].filter(r => r.owner.tenantId === actor.tenantId).length >= 128 || this.rows.size >= 5000)
      fail(429, 'capacity', 'The application limit has been reached.')
    const key = req.publicKey, appId = id('app')
    const row: PartnerEnrollmentRow = { owner: { userId: actor.userId, tenantId: actor.tenantId }, keyMaterial: [key],
      domains: [], reports: [], history: [], bindings: {}, identityRevision: 1, published: false, sandboxReportId: req.sandboxReportId,
      app: { applicationId: appId, partnerId: id('org'), environment: env, revision: 0, state: 'awaiting_proof',
        displayName: req.displayName, organization: req.organization, organizationUrl: req.organizationUrl, handoffUrl: req.handoffUrl,
        contact: req.contact, recoveryContact: req.recoveryContact, catalog: req.catalog, requestedCapabilities: req.capabilities,
        acceptedCapabilities: [], domainChallengeIds: {}, keys: [{ kid: key.kid, state: 'candidate', thumbprint: thumbprint(key), validFrom: iso(this.now()) }] } }
    this.challenge(row, key)
    this.rows.set(appId, row)
    this.note(row, actor.userId, 'applied')
    return structuredClone(row.app)
  }
  applications(actor: PartnerActor, env: PartnerEnvironment) {
    return [...this.rows.values()].filter(r => r.app.environment === env && (actor.operator ||
      actor.organizationAdmin && r.owner.tenantId === actor.tenantId)).map(r => this.view(actor,r))
  }
  private view(actor:PartnerActor, row:PartnerEnrollmentRow):PartnerApplication {
    return {...structuredClone(row.app), viewer:{canManage:actor.organizationAdmin && actor.tenantId === row.owner.tenantId,
      canReview:actor.operator && actor.userId !== row.owner.userId && actor.tenantId !== row.owner.tenantId}}
  }
  application(actor: PartnerActor, env: PartnerEnvironment, appId: string) {
    return this.view(actor,this.row(actor, env, appId))
  }
  rename(actor:PartnerActor,env:PartnerEnvironment,appId:string,input:unknown) {
    const row=this.row(actor,env,appId,true), body=fields(input,['displayName','expectedRevision'])
    this.revision(row,body.expectedRevision)
    if (row.app.state==='revoked' || row.app.state==='rejected') return inactive()
    const name=partnerDisplayName(body.displayName)
    if (name!==row.app.displayName) {
      const previous=row.app.displayName
      row.app.displayName=name
      this.note(row,actor.userId,'renamed',previous)
    }
    return this.view(actor,row)
  }
  history(actor: PartnerActor, env: PartnerEnvironment, appId: string) {
    return structuredClone(this.row(actor, env, appId).history)
  }
  keyChange(actor: PartnerActor, env: PartnerEnvironment, appId: string, input: unknown) {
    const raw = record(input), registering = raw.action === 'register'
    const body = fields(input, registering ? ['action', 'expectedRevision', 'publicKey'] : ['action', 'expectedRevision', 'kid', 'reason'])
    const row = this.row(actor, env, appId, registering)
    if (!actor.freshAuth) return fail(403,'fresh_auth_required','Sign in again before changing a partner signing key.')
    this.revision(row, body.expectedRevision)
    if (['revoked','rejected'].includes(row.app.state)) return inactive()
    if (registering) {
      const key = publicKey(body.publicKey), old = row.app.keys.find(k => k.kid === key.kid)
      if ([...this.rows.values()].some(other=>other.keyMaterial.some(k=>k.x === key.x &&
          (other !== row || k.kid !== key.kid)))) conflict('Generate a separate signing key for this enrollment.')
      if (old && (old.thumbprint !== thumbprint(key) || old.state !== 'candidate')) conflict('This key identifier is already bound.')
      if (!old && row.app.keys.length >= 16) conflict('The enrollment key limit has been reached.')
      this.challenge(row, key)
      if (!old) {
        row.keyMaterial.push(key)
        row.app.keys.push({ kid: key.kid, state: 'candidate', thumbprint: thumbprint(key), validFrom: iso(this.now()) })
      }
      this.note(row, actor.userId, 'key_registered', undefined, key.kid)
    } else {
      if (body.action !== 'revoke') fail(400, 'bad_request', 'Choose register or revoke.')
      const kid = tokenId(body.kid), reason = label(body.reason, 300, 'revocation reason')
      const key = row.app.keys.find(k => k.kid === kid) ?? missing()
      if (key.state === 'revoked') conflict('The key has already been revoked.')
      key.state = 'revoked'
      key.validUntil = iso(this.now())
      if (row.app.challenge?.kid === kid) delete row.app.challenge
      this.note(row, actor.userId, 'key_revoked', reason, kid)
    }
    return structuredClone(row.app)
  }
  proveKey(actor: PartnerActor, env: PartnerEnvironment, appId: string, input: unknown) {
    const row = this.row(actor, env, appId, true), body = fields(input, ['signedProof']), challenge = row.app.challenge
    if (!challenge || Date.parse(challenge.expiresAt) <= this.now() || ['revoked','rejected'].includes(row.app.state))
      return fail(409, 'expired', 'Request a current signing-key challenge.')
    const { kid, claims } = verifiedJws(body.signedProof, 'partner-key-proof+jwt', k => this.key(row, k, true))
    fields(claims, ['iss','aud','jti','iat','exp','applicationId','environment','kid','nonce'])
    const now = Math.floor(this.now() / 1000), { iat, exp } = claims
    if (challenge.audience !== this.audience(env)+'/applications/'+appId+'/proofs' ||
        kid !== challenge.kid || claims.kid !== kid || claims.nonce !== challenge.nonce || claims.iss !== row.app.partnerId ||
        claims.aud !== challenge.audience || claims.environment !== env || claims.applicationId !== appId ||
        typeof claims.jti !== 'string' || !identifier.test(claims.jti) ||
        typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat > now + 60 || iat < now - 360 ||
        typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= now || exp <= iat || exp - iat > 300 ||
        exp > Math.floor(Date.parse(challenge.expiresAt) / 1000) + 60) fail(401, 'invalid_proof', 'The signing-key proof does not match this challenge.')
    for (const key of row.app.keys) {
      if (key.kid === kid) { key.state = 'active'; key.validFrom = iso(this.now()) }
      else if (key.state === 'active') { key.state = 'retiring'; key.validUntil = iso(this.now() + 300_000) }
    }
    delete row.app.challenge
    this.phase(row)
    this.note(row, actor.userId, 'key_verified', undefined, kid)
    return structuredClone(row.app)
  }
  issueDomain(actor: PartnerActor, env: PartnerEnvironment, appId: string, input: unknown) {
    const row = this.row(actor, env, appId, true), body = fields(input, ['purpose','expectedRevision'], ['replacementUrl'])
    if (!actor.freshAuth) return fail(403,'fresh_auth_required','Sign in again before starting a domain proof.')
    this.revision(row, body.expectedRevision)
    if (row.app.state === 'revoked' || row.app.state === 'rejected') return inactive()
    const purpose = body.purpose
    if (purpose !== 'website' && purpose !== 'handoff') return fail(400, 'bad_request', 'Choose the website or handoff host.')
    const url = partnerWebsite(body.replacementUrl ?? (purpose === 'website' ? row.app.organizationUrl : row.app.handoffUrl), purpose)
    const previous = row.domains.find(d => d.challenge.challengeId === row.app.domainChallengeIds[purpose])
    if (previous && previous.challenge.state === 'pending') previous.challenge.state = 'superseded'
    const challenge: PartnerDomainChallenge = { challengeId: id('dns'), applicationId: appId, environment: env, purpose,
      domainAscii: url.hostname, recordName: '_agentcommons.' + url.hostname,
      recordValue: 'agentcommons-v1=' + randomBytes(32).toString('base64url'), expiresAt: iso(this.now() + day), state: 'pending' }
    row.domains = row.domains.filter(d => dnsPurposes.some(p => row.bindings[p] === d.challenge.challengeId ||
      row.app.domainChallengeIds[p] === d.challenge.challengeId) || d.challenge.state === 'pending')
    row.domains.push({ challenge, url: url.href })
    row.app.domainChallengeIds[purpose] = challenge.challengeId
    this.note(row, actor.userId, 'domain_challenge_issued', undefined, challenge.challengeId)
    return structuredClone(challenge)
  }
  private hostClaimed(row: PartnerEnrollmentRow, host: string) {
    return [...this.rows.values()].some(r => r !== row && r.published && r.app.state !== 'revoked' &&
      this.live(r, 'website')?.challenge.domainAscii === host)
  }
  private async observe(row: PartnerEnrollmentRow, entry: DomainRecord, actorRef: string) {
    const c = entry.challenge, previous = this.live(row, c.purpose)
    if (row.app.state === 'revoked' || row.app.state === 'rejected') return
    if (c.state !== 'pending' && (c.state !== 'verified' || previous !== entry)) return
    if (c.state === 'pending' && Date.parse(c.expiresAt) <= this.now() ||
        c.state === 'verified' && (entry.verifiedAt ?? 0) + day * 30 <= this.now()) {
      c.state = 'expired'
      this.note(row, actorRef, 'domain_challenge_expired', undefined, c.challengeId)
      return
    }
    const start = row.app.revision
    let records: string[][]
    try { records = await this.resolveTxt(c.recordName + '.') }
    catch (error) {
      const code = (error as {code?: string})?.code
      if (code !== 'ENODATA' && code !== 'ENOTFOUND') return fail(503, 'dns_unavailable', 'DNS could not be checked. Try again shortly.')
      records = []
    }
    if (this.rows.get(row.app.applicationId) !== row || row.app.revision !== start) return
    if (c.state === 'pending' && Date.parse(c.expiresAt) <= this.now()) {
      c.state = 'expired'
      this.note(row, actorRef, 'domain_challenge_expired', undefined, c.challengeId)
      return
    }
    if (!records.some(chunks => chunks.join('') === c.recordValue)) {
      if (previous === entry && !entry.contradicted) {
        entry.contradicted = true
        this.workers.invalidatePartner(row.app.partnerId)
        this.note(row, actorRef, 'domain_proof_lost', undefined, c.challengeId)
      }
      return
    }
    if (c.purpose === 'website' && row.published && this.hostClaimed(row, c.domainAscii)) {
      c.state = 'conflict'
      this.note(row, actorRef, 'domain_conflict', undefined, c.challengeId)
      return
    }
    if (previous && previous !== entry && row.published && previous.url !== entry.url) {
      row.identityRevision++
      this.workers.invalidatePartner(row.app.partnerId)
      if (row.app.state === 'active') row.app.state='in_review'
      this.noteIdentityChange(row, previous)
    }
    c.state = 'verified'
    entry.verifiedAt ??= this.now()
    entry.observedAt = this.now()
    entry.contradicted = false
    row.bindings[c.purpose] = c.challengeId
    if (c.purpose === 'website') row.app.organizationUrl = entry.url
    else row.app.handoffUrl = entry.url
    this.phase(row)
    this.note(row, actorRef, 'domain_verified', undefined, c.challengeId)
  }
  private noteIdentityChange(row: PartnerEnrollmentRow, previous: DomainRecord) {
    row.history.push({ eventId: id('event'), actorRef: 'registry', recordedAt: iso(this.now()),
      action: 'binding_replaced', revision: row.app.revision + 1, reason: previous.challenge.domainAscii,
      reference: previous.challenge.challengeId })
  }
  async checkDomain(actor: PartnerActor, env: PartnerEnvironment, appId: string, challengeId: string) {
    const row = this.row(actor, env, appId, true)
    const entry = row.domains.find(d => d.challenge.challengeId === challengeId) ?? missing()
    if (entry.challenge.state === 'pending' || this.now() - (entry.observedAt ?? 0) >= 60_000)
      await this.observe(row, entry, actor.userId)
    return structuredClone(entry.challenge)
  }
  /** Called by the scheduler. Recheck before the 24-hour cutoff. Transient DNS
   * errors leave the previous expiry intact; a definite missing record lapses immediately. */
  async recheckDue() {
    for (const row of this.rows.values()) {
      for (const report of row.reports) {
        if (expireConformance(report,this.now())) this.note(row,'registry','conformance_expired',undefined,report.public.reportId)
      }
      if (['revoked','rejected'].includes(row.app.state)) continue
      for (const purpose of dnsPurposes) {
        const d = this.live(row, purpose)
        if (d?.challenge.state !== 'verified' || this.now() - (d.observedAt ?? 0) < day / 2) continue
        try { await this.observe(row, d, 'dns-worker') }
        catch (e) { if (!(e instanceof PartnerRegistryError && e.code === 'dns_unavailable')) throw e }
      }
    }
  }
  private qualified(actor: Pick<PartnerActor, 'userId' | 'tenantId'>, reportId: string | undefined,
    catalog: PartnerApplication['catalog'], roles: PartnerCapability[], site: string, productionKey: PartnerPublicKey,
    acceptRenewedReport=false): string | undefined {
    const host=new URL(site).hostname
    const source=[...this.rows.values()].find(row => row.app.environment === 'sandbox' && row.owner.tenantId === actor.tenantId &&
      row.app.state === 'sandbox_testing' && this.proved(row) &&
      new URL(row.app.organizationUrl).hostname === host && !row.keyMaterial.some(key => key.x === productionKey.x) &&
      roles.every(role => row.app.requestedCapabilities.includes(role)) && row.reports.some(r=>r.public.reportId === reportId))
    const digest=catalogDigest(catalog)
    return source?.reports.filter(r => (acceptRenewedReport || r.public.reportId === reportId) && r.primaryHost===host &&
      r.public.state === 'passed' && r.public.catalogDigest === digest && r.finishedAt !== undefined &&
      r.finishedAt <= this.now() && this.now() < r.finishedAt + 30*day).sort((a,b)=>b.finishedAt!-a.finishedAt!)[0]?.public.reportId
  }
  conformance(actor: PartnerActor, env: PartnerEnvironment, appId: string, input: unknown) {
    const row = this.row(actor, env, appId, true), body = fields(input, ['expectedRevision'])
    this.revision(row, body.expectedRevision)
    if (env !== 'sandbox' || row.app.state !== 'sandbox_testing' || !this.proved(row)) conflict('Verify both hosts and a sandbox signing key first.')
    if (row.reports.some(r => r.public.state === 'running' && r.startedAt + day > this.now())) conflict('A conformance run is already in progress.')
    if (row.reports.length >= 32) fail(429, 'capacity', 'The report limit has been reached.')
    const report = beginConformance(row.app, this.now(), this.verifierSamples)
    row.reports.push(report)
    row.app.conformanceReportId = report.public.reportId
    this.note(row, actor.userId, 'conformance_started', undefined, report.public.reportId)
    return structuredClone(report.public)
  }
  report(actor: PartnerActor, env: PartnerEnvironment, appId: string, reportId: string) {
    return structuredClone(this.row(actor, env, appId).reports.find(r => r.public.reportId === reportId)?.public ?? missing())
  }
  decide(actor: PartnerActor, env: PartnerEnvironment, appId: string, input: unknown) {
    const row = this.row(actor, env, appId), action = record(input).action
    if (!actor.operator || actor.userId === row.owner.userId || actor.tenantId === row.owner.tenantId)
      return fail(403, 'forbidden', 'An independent site operator must make this decision.')
    if (!actor.freshAuth) return fail(403,'fresh_auth_required','Sign in again before making a production trust decision.')
    const body = fields(input, ['action','expectedRevision','reason', ...(action === 'approve' ? ['acceptedCapabilities'] : [])])
    this.revision(row, body.expectedRevision)
    const reason = label(body.reason, 300, 'decision reason')
    if (env !== 'production' && !['suspend','revoke','reject'].includes(String(action))) conflict('Production enrollment is required.')
    if (action === 'approve' || action === 'resume') {
      if (row.app.state !== (action === 'approve' ? 'in_review' : 'suspended') || !this.proved(row)) return inactive()
      if (this.hostClaimed(row, this.live(row, 'website')!.challenge.domainAscii)) conflict('The verified host already belongs to another published partner.')
      const accepted = action === 'approve' ? capabilities(body.acceptedCapabilities) : row.app.acceptedCapabilities
      if (!accepted.every(c => row.app.requestedCapabilities.includes(c))) conflict('A capability was outside the application.')
      const reportId=this.qualified(row.owner, row.sandboxReportId, row.app.catalog, accepted, row.app.organizationUrl,
        this.key(row, row.app.keys.find(k => k.state === 'active')!.kid)!, row.published)
      if (!reportId) conflict('Run a current matching conformance report on the originating sandbox application.')
      row.sandboxReportId=reportId
      row.app.acceptedCapabilities = accepted
      row.app.state = 'active'
      row.published = true
    } else if (action === 'suspend' && ['active','sandbox_testing'].includes(row.app.state)) row.app.state = 'suspended'
    else if (action === 'revoke' && (row.published || ['suspended','sandbox_testing'].includes(row.app.state)) &&
             row.app.state !== 'revoked') row.app.state = 'revoked'
    else if (action === 'reject' && ['in_review','awaiting_proof'].includes(row.app.state)) row.app.state = row.published ? 'suspended' : 'rejected'
    else return conflict('This decision does not apply to the current state.')
    if (action === 'suspend' || action === 'revoke' || action === 'reject') this.workers.invalidatePartner(row.app.partnerId)
    row.app.decisionReason = reason
    this.note(row, actor.userId, 'decision_' + action, reason, action==='approve' || action==='resume' ? row.sandboxReportId : undefined)
    return structuredClone(row.app)
  }
  private publicRows() { return [...this.rows.values()].filter(row => row.published && row.app.environment === 'production') }
  private directory() {
    return this.nameIndex ??= new PartnerNameIndex(this.publicRows().map(row=>({
      partnerId:row.app.partnerId,displayName:row.app.displayName,domain:this.live(row,'website')!.challenge.domainAscii })))
  }
  private profile(row: PartnerEnrollmentRow) {
    const website = this.live(row, 'website') ?? missing(), handoff = this.live(row, 'handoff') ?? missing()
    const status = row.app.state === 'suspended' || row.app.state === 'revoked' ? row.app.state :
      row.app.state === 'active' && this.proved(row) ? 'active' : 'verification_lapsed'
    return { partnerId: row.app.partnerId, displayName: row.app.displayName, status,
      capabilities: status === 'active' ? [...row.app.acceptedCapabilities] : [], asOf: iso(this.now()),
      identity: { domainAscii: website.challenge.domainAscii, identityRevision: row.identityRevision, profilePath: '/partners/' + row.app.partnerId,
        verifiedAt: iso(website.verifiedAt!), validUntil: iso(Math.min(domainUntil(website), domainUntil(handoff))),
        ...this.directory().peers(row.app.partnerId) } } satisfies PartnerPublicProfile
  }
  publicProfile(partnerId: string): PartnerPublicProfile {
    const rows = this.publicRows(), row = rows.find(r => r.app.partnerId === partnerId) ?? missing()
    return this.profile(row)
  }
  catalog(filter: {domainAscii?: string; name?: string; capability?: string} = {}): PartnerCatalogEntry[] {
    if (filter.name !== undefined && filter.domainAscii !== undefined) fail(400, 'bad_request', 'Choose name or exact domain lookup.')
    if (filter.capability && !partnerCapabilities.some(r => r === filter.capability)) fail(400, 'bad_request', 'Unknown capability.')
    if (filter.domainAscii !== undefined && partnerWebsite('https://' + filter.domainAscii, 'website').hostname !== filter.domainAscii)
      fail(400, 'bad_request', 'Supply the precise ASCII hostname.')
    const found = filter.name === undefined ? undefined : this.directory().search(label(filter.name, 100, 'name'))
    return this.publicRows().flatMap(row => {
      if (row.app.state !== 'active' || !this.proved(row) || filter.domainAscii && this.live(row,'website')!.challenge.domainAscii !== filter.domainAscii ||
          filter.capability && !row.app.acceptedCapabilities.some(role => role === filter.capability) ||
          found && !found.has(row.app.partnerId)) return []
      const p = this.profile(row)
      const roles = p.capabilities
      return [{ identity: p.identity, partnerId: p.partnerId, displayName: p.displayName, environment: row.app.environment,
        capabilities: roles, catalogRevision: row.identityRevision, catalog: structuredClone({
          models: roles.includes('model-provider') ? row.app.catalog.models : [],
          assets: roles.includes('custodian') ? row.app.catalog.assets : [],
          rules: roles.includes('verifier') ? row.app.catalog.rules : [] }) }]
    }).sort((a,b) => a.identity.domainAscii.localeCompare(b.identity.domainAscii, 'en') || a.partnerId.localeCompare(b.partnerId, 'en'))
  }
  private machine(row: PartnerEnrollmentRow, renewal = false) {
    const app = row.app
    if (!app.keys.some(k => k.state === 'active') || (renewal ?
        !['sandbox_testing','awaiting_proof','active','in_review'].includes(app.state) :
        !(app.environment === 'sandbox' ? app.state === 'sandbox_testing' : app.state === 'active') || !this.proved(row))) return inactive()
    return { applicationId: app.applicationId, partnerId: app.partnerId, environment: app.environment,
      handoffUrl: app.handoffUrl, capabilities: [...(app.environment === 'sandbox' ? app.requestedCapabilities : app.acceptedCapabilities)],
      catalog: structuredClone(app.catalog), domainAscii: new URL(app.organizationUrl).hostname, identityRevision: row.identityRevision }
  }
  machineEnrollment(env: PartnerEnvironment, partnerId: string) { return this.machine(this.byPartner(env, partnerId)) }
  verifyPartnerJws(env: PartnerEnvironment, partnerId: string, jws: unknown, typ: string) {
    const row = this.byPartner(env, partnerId)
    this.machine(row)
    return verifiedJws(jws, typ, kid => this.key(row, kid))
  }
  issueToken(env: PartnerEnvironment, body: unknown) {
    let answer: ReturnType<PartnerWorkerTokens['issue']>
    try {
      answer = this.workers.issue(env, body, this.audience(env), this.now(),
        (pid, kid) => this.key(this.byPartner(env,pid), kid),
        (pid, scopes) => {
          const target = this.machine(this.byPartner(env,pid), scopes.every(s => s === 'domains:renew'))
          if (scopes.includes('artifacts:write') && !target.capabilities.includes('model-provider'))
            fail(400, 'invalid_scope', 'Artifact upload requires model-provider authority.')
        })
    } catch(e) {
      if (e instanceof PartnerRegistryError && ['invalid_proof','identity_inactive','not_found'].includes(e.code))
        return fail(401,'invalid_client','Partner credentials were rejected.')
      throw e
    }
    this.changed()
    return answer
  }
  authorizeWorker(env: PartnerEnvironment, token: string, requiredScope: string) {
    const grant = this.workers.authorize(env, this.audience(env), token, requiredScope, this.now()), row = this.byPartner(env, grant.partnerId)
    if (!this.key(row, grant.kid)) return fail(401, 'invalid_client', 'The worker signing key is no longer active.')
    return { ...this.machine(row, requiredScope === 'domains:renew'), keyId: grant.kid, scopes: [...grant.scopes] }
  }
  private renewalOwner(env: PartnerEnvironment, token: string, appId: string) {
    const grant = this.authorizeWorker(env, token, 'domains:renew')
    if (grant.applicationId !== appId) return missing()
    const row = this.byPartner(env, grant.partnerId)
    return { userId: grant.partnerId, tenantId: row.owner.tenantId, organizationAdmin: true, operator: false, freshAuth:true }
  }
  workerDomainIssue(env: PartnerEnvironment, token: string, appId: string, input: unknown) {
    const actor = this.renewalOwner(env, token, appId)
    fields(input, ['purpose','expectedRevision'])
    const purpose = record(input).purpose
    if ((purpose !== 'website' && purpose !== 'handoff') || !this.live(this.row(actor,env,appId), purpose))
      return fail(403, 'forbidden', 'Only an established host binding may be renewed by a worker.')
    return this.issueDomain(actor, env, appId, input)
  }
  workerDomainCheck(env: PartnerEnvironment, token: string, appId: string, challengeId: string) {
    const actor = this.renewalOwner(env, token, appId), row = this.row(actor,env,appId)
    const d = row.domains.find(entry => entry.challenge.challengeId === challengeId) ?? missing()
    if (this.live(row, d.challenge.purpose)?.url !== d.url) return missing()
    return this.checkDomain(actor, env, appId, challengeId)
  }
  sandboxCommands(partnerId: string) {
    const row = this.byPartner('sandbox', partnerId)
    this.machine(row)
    return structuredClone(row.reports.filter(r => r.public.state === 'running' && r.startedAt + day > this.now())
      .flatMap(r => r.commands.filter(c => c.command.state === 'requested').map(c => c.command)))
  }
  private fixture(partnerId: string, commandId: string) {
    const row = this.byPartner('sandbox', partnerId)
    this.machine(row)
    const report = row.reports.find(r => r.commands.some(c => c.command.commandId === commandId)) ?? missing()
    return { row, report, entry: report.commands.find(c => c.command.commandId === commandId)! }
  }
  sandboxCommand(partnerId: string, commandId: string) { return structuredClone(this.fixture(partnerId,commandId).entry.command) }
  sandboxReceipt(partnerId: string, commandId: string, input: unknown) {
    const { row, report, entry } = this.fixture(partnerId,commandId)
    const { signedReceipt } = fields(input,['signedReceipt'])
    const { claims } = this.verifyPartnerJws('sandbox', partnerId, signedReceipt, 'partner-receipt+jwt')
    if (typeof claims.jti === 'string' && row.reports.some(r=>r !== report && Object.hasOwn(r.receipts,'receipt:'+claims.jti)))
      conflict('A different conformance run already owns this receipt identifier.')
    const existed = Object.hasOwn(report.receipts,'receipt:'+String(claims.jti)), observed=report.duplicateObserved
    const result = applyFixtureReceipt(report,entry,claims,String(signedReceipt),this.audience('sandbox'),this.now())
    if (!existed || observed !== report.duplicateObserved)
      this.note(row, partnerId, existed ? 'conformance_replay' : 'conformance_receipt', undefined, commandId)
    return result
  }
  sandboxReplay(partnerId:string, commandId:string, receiptId:string) {
    const {row,report,entry}=this.fixture(partnerId,commandId)
    if (observeReceiptReplay(report,entry,receiptId,this.now()))
      this.note(row,partnerId,'conformance_replay',undefined,commandId)
  }
  sandboxArtifact(partnerId: string, commandId: string, artifactId: string) {
    const { entry } = this.fixture(partnerId,commandId)
    if (entry.output?.artifactId === artifactId && entry.outputBytes !== undefined &&
        (entry.command.state==='succeeded' || this.now()<Date.parse(entry.command.deadline)))
      return {bytes:Buffer.from(entry.outputBytes,'base64'),mediaType:entry.output.mediaType,digest:entry.output.digest}
    if (entry.input?.artifactId !== artifactId) return missing()
    return { bytes: Buffer.from(entry.input.bytes, 'base64'), mediaType: entry.input.mediaType, digest: entry.input.digest }
  }
  sandboxUpload(partnerId: string, commandId: string, bytes: Buffer, mediaType: string, digest: string) {
    const { row, entry, report } = this.fixture(partnerId,commandId)
    if (entry.command.action.kind !== 'run' || entry.command.state !== 'requested' || Date.parse(entry.command.deadline) <= this.now()) return missing()
    if (!bytes.length || bytes.length > 8 * 1024 * 1024 || !['text/plain','application/json','application/octet-stream'].includes(mediaType))
      fail(400, 'bad_request', 'The artifact is empty, too large or has an unsupported media type.')
    if (digest !== sha256(bytes)) fail(400, 'bad_request', 'The artifact digest does not match its bytes.')
    if (entry.output && (entry.output.digest !== digest || entry.output.mediaType !== mediaType)) conflict('This fixture already has a different output.')
    if (!entry.output) {
      if (report.commands.reduce((sum,c)=>sum+(c.outputBytes?.length ?? 0),0) + Math.ceil(bytes.length/3)*4 > 88*1024*1024)
        fail(429,'capacity','The sandbox report artifact quota is full.')
      entry.output = {artifactId:id('output'),digest,mediaType}
      entry.outputBytes = bytes.toString('base64')
      this.note(row, partnerId, 'fixture_output', undefined, commandId)
    }
    return {...entry.output}
  }
  /** The route checks current resource access before replay. The store wraps
   * this synchronous transaction and its replay receipt in one commit batch. */
  mutate<T>(actor: PartnerActor, env: PartnerEnvironment, operation: string, resource: string, key: string,
    payload: unknown, execute: () => T, onReplay?: (response:T)=>void): T {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,160}$/.test(key)) fail(400, 'bad_request', 'A bounded idempotency key is required.')
    const binding = JSON.stringify([env,actor.tenantId,actor.userId,actor.operator,actor.organizationAdmin,operation,resource,key])
    const canonical = JSON.stringify(payload, (_, value) => value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])) : value)
    const digest = sha256(canonical), old = this.replays.get(binding)
    if (old && old.until > this.now()) {
      if (old.digest !== digest) conflict('This retry key belongs to a different request.')
      onReplay?.(structuredClone(old.response as T))
      return structuredClone(old.response as T)
    }
    if (this.replays.size >= 10_000) {
      for (const [k,r] of this.replays) if (r.until <= this.now()) this.replays.delete(k)
      if (this.replays.size >= 10_000) fail(429,'capacity','The retry receipt store is full.')
    }
    const result=execute()
    this.replays.set(binding,{key:binding,digest,until:this.now()+7*day,response:structuredClone(result)})
    this.changed()
    return result
  }
}
