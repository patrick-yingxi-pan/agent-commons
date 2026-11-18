/** Required GitHub checks run the repository's complete verifier before merge.
 * Their source is scanned here because a workflow
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

test('every pull request to main and main push runs verification without path filters', () => {
  const triggers = workflow.match(/^on:\s*\n((?:[ \t]+[^\n]*\n|\n)*)/m)
  assert.ok(triggers, 'the required workflow declares its trigger block')
  assert.equal(triggers[1].replace(/\s+/g, ' ').trim(),
    'pull_request: branches: [main] push: branches: [main] workflow_dispatch:',
    'all contributions to main need checks; filters or privileged PR triggers are not allowed')
})

test('required GitHub checks retain the complete verifier plan with bounded read-only authority', () => {
  const permissions = workflow.match(/^permissions:\s*\n((?:[ \t]+[^\n]*\n|\n)*)/m)
  assert.ok(permissions, 'the workflow explicitly bounds its token authority')
  assert.equal(permissions[1].trim(), 'contents: read')
  assert.equal([...workflow.matchAll(/^\s*permissions:/gm)].length, 1,
    'jobs cannot override the read-only workflow token')
  assert.doesNotMatch(workflow, /\bsecrets\s*[.\[]|pull_request_target:|workflow_run:/,
    'untrusted pull request verification never uses repository secrets or privileged triggers')
  assert.match(workflow, /concurrency:\s*\n\s*group: verify-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*\n\s*cancel-in-progress: true/)
  assert.match(workflow, /runs-on: ubuntu-24\.04/)
  assert.match(workflow, /timeout-minutes: 35/)
  assert.match(workflow, /strategy:\s*\n\s*fail-fast: false/)
  const matrix = workflow.match(/matrix:\s*\n\s*include:\s*\n([\s\S]*?)^    env:/m)
  assert.ok(matrix, 'the full-product job declares its complete hosted matrix')
  assert.equal(matrix[1].replace(/\s+/g, ' ').trim(), [
    '- label: Checks lane: checks e2e_part: 1 e2e_parts: 1',
    ...Array.from({ length: 6 }, (_, index) =>
      `- label: E2E ${index + 1}/6 lane: e2e e2e_part: ${index + 1} e2e_parts: 6`),
  ].join(' '), 'required check names cover exactly six isolated E2E partitions and the checks lane')
  assert.match(workflow, /CI: true\s*\n(?:\s*#[^\n]*\n)*\s*E2E_HOST_FACTOR: 4\s*\n\s*VERIFY_E2E_PART: \$\{\{ matrix\.e2e_part \}\}\s*\n\s*VERIFY_E2E_PARTS: \$\{\{ matrix\.e2e_parts \}\}/)
  assert.doesNotMatch(workflow, /E2E_SHARDS:/,
    'each CI runner must retain one CPU-safe local stack rather than oversubscribing')
  assert.match(workflow, /run: npm ci/)
  assert.match(workflow, /if: matrix\.lane == 'e2e'\s*\n\s*run: npx playwright install --with-deps chromium/)
  assert.doesNotMatch(workflow, /run: npm (?:test|run (?:typecheck|build|e2e))\s*$/m,
    'the workflow must not hand-maintain a partial copy of the verifier')
})

test('every required verifier job runs its lane and propagates failure', () => {
  const job = workflow.match(/^  full-product:\s*\n([\s\S]*?)(?=^  [\w-]+:|(?![\s\S]))/m)
  assert.ok(job, 'the required matrix job exists')
  assert.match(job[1], /^    name: \$\{\{ matrix\.label \}\}\s*$/m)
  assert.doesNotMatch(job[1], /^    (?:if|needs|continue-on-error):/m,
    'a required verifier job must run for every pull request and propagate a failing exit')

  const step = job[1].match(/^      - name: Verify \$\{\{ matrix\.label \}\}\s*\n([\s\S]*?)(?=^      - |(?![\s\S]))/m)
  assert.ok(step, 'the required job contains the verifier step')
  assert.match(step[1], /^        run: npm run verify -- \$\{\{ matrix\.lane \}\}[ \t]*\r?$/m)
  assert.doesNotMatch(step[1], /^        (?:if|continue-on-error):/m,
    'a required lane cannot skip its verifier or treat a failure as success')
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

test('pull requests reject new high-severity vulnerable dependencies without posting comments', () => {
  const review = workflow.match(/^  dependency-review:\s*\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/m)
  assert.ok(review, 'the required Dependency review job exists')
  assert.match(review[1], /name: Dependency review/)
  assert.match(review[1], /if: github\.event_name == 'pull_request'/)
  assert.match(review[1], /runs-on: ubuntu-24\.04/)
  assert.match(review[1], /timeout-minutes: 10/)
  assert.match(review[1], /uses: actions\/checkout@[a-f0-9]{40}[^\n]*\n\s*with:\s*\n\s*persist-credentials: false/)
  assert.match(review[1], /uses: actions\/dependency-review-action@[a-f0-9]{40}[^\n]*\n\s*with:\s*\n\s*fail-on-severity: high\s*\n\s*comment-summary-in-pr: never/)
  assert.doesNotMatch(review[1], /continue-on-error:|allow-.*:|fail-on-severity: critical/,
    'dependency review cannot silently suppress vulnerable dependency failures')
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
