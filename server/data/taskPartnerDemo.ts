import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PartnerApplication, PartnerCapability, PartnerCatalog, PartnerEnvironment, PartnerPublicKey, PartnerRule } from '../../contract/taskPartners.ts'
import type { AccountRegistry } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { resolveIdentity } from '../identity.ts'
import { demoPartnerAudience } from '../taskPartners/demoConfiguration.ts'
import { deploymentAudience } from '../taskPartners/deployment.ts'
import { day, id, sha256, thumbprint } from '../taskPartners/protocol.ts'
import { PartnerRegistry, PartnerRegistryError, type PartnerActor, type PartnerRegistryOptions } from '../taskPartners/registry.ts'
import { deploymentVerifierSamples } from '../taskPartners/verifierSamples.ts'

export type { KeyObject }
export { demoPartnerAudience }
export const DEMO_READY_RULE: PartnerRule = {
  ruleId: 'exact-ready', version: 1, digest: sha256('v1: submitted bytes equal UTF-8 "ready"'),
}

interface Fixture {
  slug: string
  displayName: string
  domain: string
  organization: string
  admin: 'maya' | 'noor'
  capabilities: PartnerCapability[]
  catalog: PartnerCatalog
}
const fixtures: Fixture[] = [
  { slug: 'orchard-labs', displayName: 'Orchard Works', domain: 'orchard-labs.example.com',
    organization: 'Orchard Labs', admin: 'maya', capabilities: ['model-provider'],
    catalog: { models: [{ model: 'orchard-demo', efforts: ['standard'] }], assets: [], rules: [] } },
  { slug: 'orchard-coop', displayName: 'Orchard Work', domain: 'orchard-coop.example.com',
    organization: 'Orchard Co-op', admin: 'noor', capabilities: ['custodian', 'verifier'],
    catalog: { models: [], assets: [{ assetId: 'review-voucher', unit: 'voucher' }], rules: [DEMO_READY_RULE] } },
]
export interface DemoPartnerWorker {
  partnerId: string
  slug: string
  displayName: string
  domain: string
  catalog: PartnerCatalog
  kid: string
  privateKey: KeyObject
}

export function signDemoPartnerJwt(privateKey: KeyObject, kid: string, typ: string, claims: unknown): string {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const payload = encode({ alg: 'Ed25519', typ, kid }) + '.' + encode(claims)
  return payload + '.' + sign(null, Buffer.from(payload), privateKey).toString('base64url')
}

/** Keys stay in the local demo's private data directory, outside the application
 * snapshot and workspace export. A separate installation gets independent keys. */
function demoKey(directory: string, slug: string, env: PartnerEnvironment) {
  const kid = slug + '-' + env
  const filename = join(directory, kid + '.pem')
  let pem: string
  try {
    pem = readFileSync(filename, 'utf8')
  } catch (error) {
    if ((error as {code?: string}).code !== 'ENOENT') throw error
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const key = generateKeyPairSync('ed25519').privateKey
    const temporary = filename + '.' + randomUUID()
    writeFileSync(temporary, key.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
    try {
      linkSync(temporary, filename)
    } catch (e) {
      if ((e as {code?: string}).code !== 'EEXIST') throw e
    } finally { unlinkSync(temporary) }
    pem = readFileSync(filename, 'utf8')
  }
  const privateKey = createPrivateKey(pem)
  const { x } = createPublicKey(privateKey).export({ format: 'jwk' })
  if (!x) throw new Error('Invalid local demo signing key.')
  const publicKey: PartnerPublicKey = { kid, kty: 'OKP', crv: 'Ed25519', x }
  return { kid, privateKey, publicKey }
}
type DemoKey = ReturnType<typeof demoKey>

/** The same seeded-password, signed-session, membership and maintainer checks
 * used for the demo UI. This capability exists only during opted-in boot. */
function actor(accounts: AccountRegistry, name: string, tenantId: string): PartnerActor | undefined {
  const userId = 'user-' + name
  const user = accounts.users.get(userId)
  if (!user?.seeded || !user.email || accounts.verifyPassword(user.email, name + '-demo-password')?.id !== userId ||
      !accounts.identityFor(userId, tenantId)) return
  const now = Date.now()
  const token = signSession({ userId, tenantId, iat: now, authenticatedAt: now })
  const who = resolveIdentity('remote', { cookie: SESSION_COOKIE + '=' + token })
  if (who.via !== 'session' || who.user.id !== userId || who.tenant.id !== tenantId) return
  return { userId, tenantId, operator: !!who.instanceAdmin, organizationAdmin: ['owner', 'admin'].includes(who.role), freshAuth: true }
}

type SandboxCommand = ReturnType<PartnerRegistry['sandboxCommands']>[number]
type SandboxArtifact = ReturnType<PartnerRegistry['sandboxUpload']>
function sandboxOutcome(registry: PartnerRegistry, cmd: SandboxCommand, previousOutput?: SandboxArtifact) {
  const a = cmd.action
  switch (a.kind) {
    case 'reserve': return { ...a, reservationId: 'hold-' + cmd.commandId }
    case 'release':
    case 'return': return { ...a, transferRef: 'settle-' + cmd.commandId }
    case 'run': {
      const input = a.input as { artifactId: string }
      const { digest } = registry.sandboxArtifact(cmd.partnerId, cmd.commandId, input.artifactId)
      const bytes = Buffer.from('ready')
      const output = previousOutput ?? registry.sandboxUpload(cmd.partnerId, cmd.commandId, bytes, 'text/plain', sha256(bytes))
      return { kind: 'run', grantRef: a.grantRef, submissionId: a.submissionId, providerRunId: 'run-' + cmd.commandId,
        inputDigest: digest, actualModel: a.model, actualEffort: a.effort, output }
    }
    case 'verify': {
      const input = a.submission as { artifactId: string }
      const { bytes, digest } = registry.sandboxArtifact(cmd.partnerId, cmd.commandId, input.artifactId)
      return { kind: 'verify', submissionId: a.submissionId, submissionDigest: digest, rule: a.rule,
        verdict: bytes.toString('base64') === 'cmVhZHk=' ? 'passed' : 'rejected', detailCode: 'exact-ready' }
    }
    default: throw new Error('Unexpected demo conformance command.')
  }
}

function completeSandbox(registry: PartnerRegistry, who: PartnerActor, app: PartnerApplication, key: DemoKey) {
  const prior = app.conformanceReportId && registry.snapshot().rows.find(row => row.app.applicationId === app.applicationId)
    ?.reports.find(report => report.public.reportId === app.conformanceReportId)
  const now = Date.now()
  if (prior && prior.public.state === 'passed' && prior.finishedAt !== undefined && now < prior.finishedAt + 30 * day)
    return prior.public.reportId
  const report = prior && prior.public.state === 'running' && now < prior.startedAt + day ? prior.public :
    registry.conformance(who, 'sandbox', app.applicationId, { expectedRevision: app.revision })
  function deliver(cmd: SandboxCommand, previousOutput?: SandboxArtifact) {
    const receipt = { signedReceipt: signDemoPartnerJwt(key.privateKey, key.kid, 'partner-receipt+jwt', {
      iss: app.partnerId, aud: demoPartnerAudience('sandbox'), jti: cmd.commandId, iat: Math.floor(Date.parse(cmd.issuedAt) / 1000),
      environment: 'sandbox', commandId: cmd.commandId, taskId: cmd.taskId, termsVersion: cmd.termsVersion,
      termsDigest: cmd.termsDigest, outcome: sandboxOutcome(registry, cmd, previousOutput),
    }) }
    registry.sandboxReceipt(app.partnerId, cmd.commandId, receipt)
    registry.sandboxReceipt(app.partnerId, cmd.commandId, receipt)
  }
  for (let commands = registry.sandboxCommands(app.partnerId); commands.length; commands = registry.sandboxCommands(app.partnerId)) {
    for (const cmd of commands) deliver(cmd)
  }
  // An interrupted boot can have persisted the last acknowledgement before
  // its duplicate. Resign the same evidence, including the original output.
  if (registry.report(who, 'sandbox', app.applicationId, report.reportId).state === 'running') {
    const saved = registry.snapshot().rows.find(r => r.app.applicationId === app.applicationId)
      ?.reports.find(r => r.public.reportId === report.reportId)
    const acknowledged = saved?.commands.find(entry => entry.command.state === 'succeeded')
    if (saved && !saved.duplicateObserved && acknowledged) deliver(acknowledged.command, acknowledged.output)
  }
  if (registry.report(who, 'sandbox', app.applicationId, report.reportId).state !== 'passed')
    throw new Error('The demo partner did not pass conformance.')
  return report.reportId
}

/** Construct only for the loopback development showcase. All ordinary DNS and
 * verifier samples continue through their deployment adapters. */
export function createDemoPartnerBootstrap({ keyDirectory, enabled }: { keyDirectory: string; enabled: () => boolean }) {
  const records = new Map<string, Set<string>>()
  const resolver = new Resolver({ timeout: 3000, tries: 2 })
  const registryOptions: PartnerRegistryOptions = {
    demoEnabled: enabled,
    audience: env => enabled() ? demoPartnerAudience(env) : deploymentAudience(env),
    resolveTxt: host => {
      const values = enabled() ? records.get(host) : undefined
      return values ? Promise.resolve([...values].map(value => [value])) : resolver.resolveTxt(host)
    },
    verifierSamples: rule => enabled() && rule.ruleId === DEMO_READY_RULE.ruleId && rule.version === DEMO_READY_RULE.version &&
      rule.digest === DEMO_READY_RULE.digest
      ? [{ mediaType: 'text/plain', base64: 'cmVhZHk=', verdict: 'passed' },
        { mediaType: 'text/plain', base64: 'cmVhZHkK', verdict: 'rejected' }]
      : deploymentVerifierSamples(rule),
  }
  async function enroll(registry: PartnerRegistry, fixture: Fixture, who: PartnerActor, env: PartnerEnvironment, key: DemoKey,
    initialReport?: () => string) {
    const apps = registry.applications(who, env)
    let app = apps.find(a => a.demo && a.viewer?.canManage && a.keys.some(k => k.thumbprint === thumbprint(key.publicKey)))
    if (!app) {
      if (apps.some(a => new URL(a.organizationUrl).hostname === fixture.domain || a.keys.some(k => k.kid === key.kid))) return
      const reportId = initialReport?.()
      app = registry.apply(who, env, {
        displayName: fixture.displayName, organization: fixture.organization, organizationUrl: 'https://' + fixture.domain,
        handoffUrl: 'https://auth.' + fixture.domain + '/confirm', contact: 'partners@' + fixture.domain,
        recoveryContact: 'operations@' + fixture.domain, publicKey: key.publicKey, capabilities: fixture.capabilities,
        catalog: fixture.catalog, ...(reportId && { sandboxReportId: reportId }),
      }, {demo: true})
    }
    if (['suspended', 'revoked', 'rejected'].includes(app.state) || new URL(app.organizationUrl).hostname !== fixture.domain ||
      app.handoffUrl !== 'https://auth.' + fixture.domain + '/confirm') return
    const signingKey = app.keys.find(k => k.kid === key.kid)
    if (signingKey?.state === 'candidate') {
      if (app.challenge?.kid !== key.kid || Date.parse(app.challenge.expiresAt) <= Date.now())
        app = registry.keyChange(who, env, app.applicationId, { action: 'register', expectedRevision: app.revision, publicKey: key.publicKey })
      const proof = app.challenge!
      const iat = Math.floor(Date.now() / 1000)
      app = registry.proveKey(who, env, app.applicationId, { signedProof: signDemoPartnerJwt(key.privateKey, key.kid, 'partner-key-proof+jwt', {
        iss: app.partnerId, aud: proof.audience, jti: id('proof'), iat, exp: iat + 240,
        applicationId: app.applicationId, environment: env, kid: key.kid, nonce: proof.nonce,
      }) })
    } else if (signingKey?.state !== 'active') return
    const saved = registry.snapshot().rows.find(r => r.app.applicationId === app!.applicationId)!
    for (const purpose of ['website', 'handoff'] as const) {
      const domain = (purpose === 'handoff' ? 'auth.' : '') + fixture.domain
      const entry = saved.domains.find(d => d.challenge.challengeId === app!.domainChallengeIds[purpose])
      if (entry && entry.challenge.domainAscii !== domain) return
      const stale = !entry || entry.challenge.state === 'expired' || Date.parse(entry.challenge.expiresAt) <= Date.now() &&
        (entry.challenge.state === 'pending' || (entry.verifiedAt ?? 0) + 30 * day <= Date.now())
      const challenge = stale
        ? registry.issueDomain(who, env, app.applicationId, { purpose, expectedRevision: app.revision })
        : entry!.challenge
      if (!['pending', 'verified'].includes(challenge.state)) return
      const hostname = challenge.recordName + '.'
      if (!records.has(hostname)) records.set(hostname, new Set())
      records.get(hostname)!.add(challenge.recordValue)
      if (challenge.state === 'pending' || Date.now() - (entry?.observedAt ?? 0) > 12 * 3600000)
        if ((await registry.checkDomain(who, env, app.applicationId, challenge.challengeId)).state !== 'verified') return
      app = registry.application(who, env, app.applicationId)
    }
    return app
  }

  async function seedFixture(registry: PartnerRegistry, accounts: AccountRegistry, fixture: Fixture, reviewer: PartnerActor): Promise<DemoPartnerWorker | undefined> {
    const who = actor(accounts, fixture.admin, fixture.admin === 'maya' ? 'tenant-growthworks' : 'tenant-northlight')
    if (!who?.organizationAdmin) return
    // An upgraded local store may already contain a real applicant for this
    // example host. Leave that applicant's namespace and evidence alone.
    if (registry.applications(reviewer, 'production').some(app =>
      !app.demo && new URL(app.organizationUrl).hostname === fixture.domain)) return
    const sandboxKey = demoKey(keyDirectory, fixture.slug, 'sandbox')
    const sandbox = await enroll(registry, fixture, who, 'sandbox', sandboxKey)
    if (!sandbox) return
    const productionKey = demoKey(keyDirectory, fixture.slug, 'production')
    let production = await enroll(registry, fixture, who, 'production', productionKey,
      () => completeSandbox(registry, who, sandbox, sandboxKey))
    if (!production) return
    if (production.state === 'in_review' && !registry.history(who, 'production', production.applicationId).some(e => e.action === 'decision_approve')) {
      const { rows } = registry.snapshot()
      const application = rows.find(r => r.app.applicationId === production!.applicationId)!
      const evidence = rows.find(r => r.app.applicationId === sandbox.applicationId)?.reports.find(r => r.public.reportId === application.sandboxReportId)
      // An already-filed first application remains bound to its original report.
      if (evidence?.finishedAt !== undefined && Date.now() >= evidence.finishedAt + 30 * day) return
      production = registry.decide(reviewer, 'production', production.applicationId, { action: 'approve',
        expectedRevision: production.revision, acceptedCapabilities: fixture.capabilities,
        reason: 'Local demonstration with verified sample hosts and a passing sandbox conformance report.' })
    }
    if (production.state === 'active') return { partnerId: production.partnerId, slug: fixture.slug,
      displayName: production.displayName, domain: fixture.domain, catalog: production.catalog, kid: productionKey.kid, privateKey: productionKey.privateKey }
  }

  async function seed(registry: PartnerRegistry, accounts: AccountRegistry): Promise<DemoPartnerWorker[]> {
    if (!enabled()) return []
    const maintainer = actor(accounts, 'ada', 'tenant-acme')
    // The local fixture's reviewer has no account, session or public API grant.
    const reviewer: PartnerActor = maintainer?.operator ? maintainer : {
      userId: 'demo-onboarding-reviewer', tenantId: 'demo-review-office',
      operator: true, organizationAdmin: false, freshAuth: true,
    }
    const workers: DemoPartnerWorker[] = []
    for (const fixture of fixtures) {
      try {
        const worker = await seedFixture(registry, accounts, fixture, reviewer)
        if (worker) workers.push(worker)
      } catch (error) {
        if (!(error instanceof PartnerRegistryError && error.status === 429 && error.code === 'capacity')) throw error
      }
    }
    return workers
  }
  return { registryOptions, seed }
}
