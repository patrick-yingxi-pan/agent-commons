import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEMO_READY_RULE } from '../data/taskPartnerDemo.ts'
import { DemoPartnerLedger } from './demoPartnerLedger.ts'
import { DemoWorkerClient } from './demoPartnerWorker.ts'
import { sha256, verifiedJws } from './protocol.ts'

test('grant and receipt retries replay the original signature, issuance time and expiry after a restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-partner-evidence-'))
  const file = join(dir, 'worker.db')
  let ledger = new DemoPartnerLedger(file)
  t.after(() => { ledger.close(); rmSync(dir, { recursive: true, force: true }) })
  const first = generateKeyPairSync('ed25519')
  const second = generateKeyPairSync('ed25519')
  const worker = { slug: 'orchard-coop', partnerId: 'custodian', displayName: 'Orchard Work', domain: 'orchard-coop.example.com',
    kid: 'first-key', privateKey: first.privateKey, catalog: { models: [], assets: [], rules: [DEMO_READY_RULE] } }
  const origin = 'http://127.0.0.1:8787'
  let client = new DemoWorkerClient(worker, origin, ledger)
  const start = 1_800_000_000
  let now = start + 70
  t.mock.method(Date, 'now', () => now * 1000)
  const terms = { taskId: 'task', termsVersion: 1, termsDigest: sha256('terms') }
  const offer = { ...terms, handoffId: 'handoff', actorRef: 'actor', nonce: 'nonce', partnerId: worker.partnerId,
    environment: 'production' as const, grant: { kind: 'receive' as const, asset: { assetId: 'review-voucher', unit: 'voucher', quantity: '1' } },
    workSummary: 'One voucher', expiresAt: new Date((start + 300) * 1000).toISOString() }
  const submission = { artifactId: 'artifact', digest: sha256('ready'), mediaType: 'text/plain' }
  const command = { ...terms, commandId: 'verify', partnerId: worker.partnerId, environment: 'production', state: 'requested',
    issuedAt: new Date(start * 1000).toISOString(), action: { kind: 'verify', rule: DEMO_READY_RULE, submissionId: 'submission', submission, inputs: [] } }
  const grants = [], receipts = []
  let artifactReads = 0
  let loseAcknowledgement = true
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname
    if (path.endsWith('/oauth/token')) return Response.json({ access_token: 'token', expires_in: 300 })
    if (path.endsWith('/commands')) return Response.json({ items: [command] })
    if (path.endsWith('/artifacts/artifact')) {
      artifactReads++
      now += 10
      return new Response('ready')
    }
    const body = JSON.parse(init.body)
    const key = init.headers.get('Idempotency-Key')
    if (path.endsWith('/attestations')) grants.push({ key, jwt: body.signedGrant })
    else if (path.endsWith('/receipts')) receipts.push({ key, jwt: body.signedReceipt })
    else throw Error('Unexpected path ' + path)
    return new Response(null, { status: loseAcknowledgement ? 503 : 204 })
  })
  await assert.rejects(client.select(offer, '19'))
  await assert.rejects(client.poll())
  const jwk = { ...first.publicKey.export({ format: 'jwk' }), kid: worker.kid }
  const resolveKey = kid => kid === jwk.kid ? jwk : undefined
  const grant = verifiedJws(grants[0].jwt, 'partner-handoff+jwt', resolveKey).claims
  const receipt = verifiedJws(receipts[0].jwt, 'partner-receipt+jwt', resolveKey).claims
  assert.equal(grant.iat, start + 70)
  assert.equal(grant.exp, start + 300)
  assert.equal(receipt.iat, start + 80)
  assert.equal(receipt.outcome.verdict, 'passed')

  ledger.close()
  ledger = new DemoPartnerLedger(file)
  client = new DemoWorkerClient({ ...worker, kid: 'second-key', privateKey: second.privateKey }, origin, ledger)
  now = start + 150
  loseAcknowledgement = false
  await client.select(offer, '19')
  await client.poll()
  assert.deepEqual(grants, [grants[0], grants[0]])
  assert.deepEqual(receipts, [receipts[0], receipts[0]])
  assert.equal(artifactReads, 1)
  await assert.rejects(client.select(offer, '42'))
  now = start + 300
  await assert.rejects(client.select({ ...offer, handoffId: 'never-selected' }, '19'))
  assert.equal(grants.length, 2)
})
