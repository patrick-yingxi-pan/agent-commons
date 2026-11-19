/** Start the desktop sidecar with one fixture organization's approved profile,
 * public key and scoped worker credential. The task and signed grant pass
 * through the production handlers. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const appRoot = process.env.PARTNER_HANDOFF_TEST_APP_ROOT || resolve('.')
const moduleUrl = (path) => pathToFileURL(resolve(appRoot, path)).href
await import(moduleUrl('scripts/start.mjs'))
const { store } = await import(moduleUrl('server/store/index.ts'))
const { verifiedJws } = await import(moduleUrl('server/taskPartners/protocol.ts'))
const domain = 'orchard.example.com'
const partnerId = 'org-handoff-test'
const identity = { domainAscii: domain, profilePath: '/partners/' + partnerId, identityRevision: 1,
  verifiedAt: new Date(Date.now() - 60_000).toISOString(), validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  collisionSignals: ['confusable_domain'], relatedPartners: [] }
const catalog = { models: [{ model: 'fixture', efforts: [] }], assets: [], rules: [] }
const profile = { partnerId, displayName: 'Orchard Models', status: 'active', environment: 'production',
  capabilities: ['model-provider'], identity, catalog, asOf: new Date().toISOString() }
const registry = store.taskPartners
const originalProfile = registry.publicProfile.bind(registry)
const originalEnrollment = registry.machineEnrollment.bind(registry)
const originalAuthorize = registry.authorizeWorker.bind(registry)
const originalVerify = registry.verifyPartnerJws.bind(registry)
const publicKey = JSON.parse(process.env.TEST_PARTNER_PUBLIC_KEY)
registry.publicProfile = (id) => id === partnerId ? structuredClone(profile) : originalProfile(id)
registry.machineEnrollment = (env, id) => env === 'production' && id === partnerId
  ? { ...structuredClone(profile), identityRevision: 1, domainAscii: domain, handoffUrl: 'https://accounts.' + domain + '/authorize' }
  : originalEnrollment(env, id)
registry.catalog = () => [structuredClone(profile)]
registry.authorizeWorker = (env, token, scope) =>
  env === 'production' && token === process.env.TEST_PARTNER_WORKER && scope === 'handoffs:write'
    ? { partnerId }
    : originalAuthorize(env, token, scope)
registry.verifyPartnerJws = (env, id, statement, typ) =>
  env === 'production' && id === partnerId
    ? verifiedJws(statement, typ, kid => kid === publicKey.kid ? publicKey : undefined)
    : originalVerify(env, id, statement, typ)
process.send({ ready: true })
