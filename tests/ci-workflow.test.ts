/** Optional, manually dispatched remote diagnostics project the repository's
 * mandatory local verifier. Their source is scanned here because a workflow
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

test('remote verification is manual-only and cannot consume Actions on repository events', () => {
  const triggers = workflow.match(/^on:\s*\n((?:[ \t]+[^\n]*\n|\n)*)/m)
  assert.ok(triggers, 'the optional workflow declares its trigger block')
  assert.equal(triggers[1].trim(), 'workflow_dispatch:',
    'only an explicit manual dispatch may run optional remote diagnostics')
})

test('optional remote diagnostics retain the complete verifier plan with bounded read-only authority', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/)
  assert.match(workflow, /concurrency:\s*\n\s*group: verify-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*\n\s*cancel-in-progress: true/)
  assert.match(workflow, /runs-on: ubuntu-24\.04/)
  assert.match(workflow, /timeout-minutes: 35/)
  assert.match(workflow, /strategy:\s*\n\s*fail-fast: false/)
  assert.match(workflow, /- label: Checks\s*\n\s*lane: checks\s*\n\s*e2e_part: 1\s*\n\s*e2e_parts: 1/)
  assert.match(workflow, /- label: E2E 1\/2\s*\n\s*lane: e2e\s*\n\s*e2e_part: 1\s*\n\s*e2e_parts: 2/)
  assert.match(workflow, /- label: E2E 2\/2\s*\n\s*lane: e2e\s*\n\s*e2e_part: 2\s*\n\s*e2e_parts: 2/)
  assert.match(workflow, /CI: true\s*\n(?:\s*#[^\n]*\n)*\s*E2E_HOST_FACTOR: 4\s*\n\s*VERIFY_E2E_PART: \$\{\{ matrix\.e2e_part \}\}\s*\n\s*VERIFY_E2E_PARTS: \$\{\{ matrix\.e2e_parts \}\}/)
  assert.doesNotMatch(workflow, /E2E_SHARDS:/,
    'each CI runner must retain one CPU-safe local stack rather than oversubscribing')
  assert.match(workflow, /run: npm ci/)
  assert.match(workflow, /if: matrix\.lane == 'e2e'\s*\n\s*run: npx playwright install --with-deps chromium/)
  assert.match(workflow, /run: npm run verify -- \$\{\{ matrix\.lane \}\}/)
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

test('failed browser CI preserves first-attempt evidence under bounded retention', () => {
  assert.match(workflow, /name: Verify \$\{\{ matrix\.label \}\}[\s\S]*?E2E_TRACE: '1'/)
  const retention = workflow.slice(workflow.indexOf('- name: Preserve failed browser evidence'))
  assert.ok(retention.startsWith('- name: Preserve failed browser evidence'))
  assert.match(retention, /if: failure\(\) && matrix\.lane == 'e2e'/)
  assert.match(retention, /uses: actions\/upload-artifact@[a-f0-9]{40}/)
  assert.match(retention, /name: browser-failure-\$\{\{ matrix\.e2e_part \}\}/)
  assert.match(retention, /path: test-results\/shard-\*/)
  assert.match(retention, /retention-days: 3/)
  assert.match(retention, /include-hidden-files: false/)
  assert.doesNotMatch(retention, /path: (?:\.|out|\.data)(?:\s|\/|$)/)
})
