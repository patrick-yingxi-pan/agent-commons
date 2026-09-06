/** The remote quality gate is intentionally a projection of the repository's
 * one complete local verifier. Its source is scanned here because a workflow
 * that quietly drops E2E, floats executable actions, or gains write authority
 * can stay green while ceasing to be evidence. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from './helpers/source.ts'

const workflow = read(join(ROOT, '.github', 'workflows', 'verify.yml'))
const manifest = JSON.parse(read(join(ROOT, 'package.json')))
const lockfile = JSON.parse(read(join(ROOT, 'package-lock.json')))

test('the repository declares its supported Node floor in both npm manifests', () => {
  assert.equal(manifest.engines?.node, '>=26')
  assert.equal(lockfile.packages?.['']?.engines?.node, manifest.engines.node)
})

test('main and pull requests run the one complete verifier with bounded read-only authority', () => {
  assert.match(workflow, /pull_request:\s*\n\s*push:\s*\n\s*branches:\s*\n\s*- main/)
  assert.match(workflow, /permissions:\s*\n\s*contents: read/)
  assert.match(workflow, /concurrency:\s*\n\s*group: verify-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*\n\s*cancel-in-progress: true/)
  assert.match(workflow, /runs-on: ubuntu-24\.04/)
  assert.match(workflow, /timeout-minutes: 45/)
  assert.match(workflow, /CI: true\s*\n(?:\s*#[^\n]*\n)*\s*E2E_SHARDS: 2\s*\n\s*E2E_HOST_FACTOR: 4/)
  assert.match(workflow, /run: npm ci/)
  assert.match(workflow, /run: npx playwright install --with-deps chromium/)
  assert.match(workflow, /run: npm run verify/)
  assert.doesNotMatch(workflow, /run: npm (?:test|run (?:typecheck|build|e2e))\s*$/m,
    'the workflow must not hand-maintain a partial copy of the verifier')
})

test('third-party workflow actions are immutable and checkout leaves no push credential', () => {
  const actions = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s+(.+))?$/gm)]
  assert.ok(actions.length >= 2, 'the workflow has executable action dependencies to audit')
  for (const [, action, comment] of actions) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/,
      `${action} must be pinned to an immutable full commit SHA`)
    assert.match(comment ?? '', /^v\d+\.\d+\.\d+$/,
      `${action} must name the reviewed release beside its SHA`)
  }
  assert.match(workflow, /uses: actions\/checkout@[a-f0-9]{40}[^\n]*\n\s*with:\s*\n\s*persist-credentials: false/)
  assert.match(workflow, /uses: actions\/setup-node@[a-f0-9]{40}[^\n]*\n\s*with:\s*\n\s*node-version: 26\s*\n\s*cache: npm/)
})
