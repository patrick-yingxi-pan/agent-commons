import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { parseAgentRequestSmokeOptions, smokePackagedAgentRequests } from './agentRequestSmoke.mjs'

test('the excluded Agent Requests acceptance helper parses before native launch', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('./agentRequestSmoke.mjs', import.meta.url))], { stdio: 'pipe' })
})

test('private Agent Requests packaged acceptance is mandatory locally and excluded from shipped application', () => {
  assert.equal(ignoreFromPackage('/desktop/agentRequestSmoke.mjs'), true)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['desktop:smoke:agent-requests'], 'node desktop/agentRequestSmoke.mjs')
  assert.equal(pkg.scripts['desktop:verify'].split(' && ').filter(command => command === 'npm run desktop:smoke:agent-requests').length, 1)

  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  for (const required of [
    'createMcpFixturePackage(executable, mcpStdioSmokePatches())',
    'launchPackagedDesktop(fixture?.executable ?? executable, profile)',
    "api(page, '/auth/signup'",
    "api(page, '/auth/session'",
    "api(page, '/agent-request-options')",
    "api(page, `/agent-requests/${first.id}`)",
    "name: 'Run once', exact: true",
    "name: 'Share reply', exact: true",
    "name: 'Use a tool…', exact: true",
    'async function ownerDirectReply(page, origin, requestId, reply)',
    "directOwner.execution, undefined, 'a direct reply has no execution receipt'",
    "'a direct reply never calls the model'",
    "storedDirect.execution, undefined, 'SQLite stores the exact direct-reply lifecycle without a tool receipt'",
    'direct reply never starts the local program',
    'direct reply never calls MCP',
    "assert.deepEqual(storedRequest(profile, direct.id), storedDirect",
    'requester-direct-reply-after-relaunch.png',
    'requesterDirectReplySurvivesRelaunch: true',
    "name: 'Draft arguments', exact: true",
    "name: 'Use draft', exact: true",
    "completedOwner.argumentDraft.status, 'done'",
    "privateRequester.argumentDraft, undefined",
    "recoveredDraft.argumentDraft.status, 'uncertain'",
    "model.argumentRequests.length, 2, 'argument advice runs exactly twice, including the interrupted attempt'",
    "model.replyRequests.length, 2, 'the successful and isolated interrupted reply attempts are exact and never repeated'",
    "model.requests.length, 4, 'two argument calls and two reply calls are the exact aggregate after both relaunches'",
    "recoveredPendingReply.replyDraft.status, 'uncertain'",
    "storedRecoveredPendingReply.replyDraft.inputHash, pendingReplySaved.replyDraft.inputHash",
    "assert.deepEqual(storedRequest(profile, replyDraftRequest.id), storedSharedReplyDraft",
    "Object.hasOwn(storedReplyDraft.replyDraft, 'notes'), false",
    "requesterReplyDraft.replyDraft, undefined, 'the requester cannot read the private model reply receipt'",
    "requester-edited-model-reply-after-relaunch.png",
    "assert.deepEqual(supplied, { task, notes }, 'only the exact task and explicit notes enter the user prompt')",
    "modelRequest.tools, undefined, 'reply drafting has no tool schema'",
    "'the exact reviewed receiving-Agent model binding is submitted'",
    "execution.status, 'uncertain'",
    'toolCalls(afterRestart).length, 2',
    'fixture?.close()',
  ]) assert.ok(source.includes(required), `packaged acceptance retains ${required}`)
  assert.equal(source.includes('mcpStdioSmokeReviewCount'), false, 'Agent Requests reuses the exact stdio setup fixture')
  assert.equal(source.includes("process.env[GATE] = '1'"), true, 'only the disposable stdio fixture gate is enabled')
  assert.equal(source.includes('assert.deepEqual(storedRequest(profile, second.id), recovered)'), false,
    'stored private rows are compared through their persisted lifecycle, not their different public view shape')
})

test('Agent Requests native-review CLI accepts only one explicit option', () => {
  assert.deepEqual(parseAgentRequestSmokeOptions([]), { nativeReview: false })
  assert.deepEqual(parseAgentRequestSmokeOptions(['--native-review']), { nativeReview: true })
  for (const invalid of [
    undefined,
    null,
    {},
    '--native-review',
    ['--native-review', '--native-review'],
    ['--unknown'],
    ['--native-review', '--unknown'],
  ]) assert.throws(() => parseAgentRequestSmokeOptions(invalid), /Usage:/)
})

test('Agent Requests smoke rejects non-boolean mode before creating evidence or launching an app', async () => {
  await assert.rejects(smokePackagedAgentRequests({ nativeReview: 'true' }), /Invalid native review mode/)
  await assert.rejects(smokePackagedAgentRequests({ nativeReview: 1 }), /Invalid native review mode/)
})

function assertNativeAgentRequestReviewContract(source) {
  assert.match(source, /export function parseAgentRequestSmokeOptions\(argv\)/)
  assert.match(source, /argv\.length > 1/)
  assert.match(source, /argv\.some\(argument => argument !== '--native-review'\)/)
  assert.match(source, /nativeReview = false/)
  assert.match(source, /typeof nativeReview !== 'boolean'/)
  const validation = source.indexOf("typeof nativeReview !== 'boolean'")
  const profile = source.indexOf("mkdtemp(join(tmpdir(), 'ac-agent-requests-smoke-'))")
  assert.ok(validation >= 0 && profile > validation, 'mode validation precedes profile and evidence creation')

  const nativeHash = source.indexOf('const sourceAsarSha256 = await asarSha256(sourceAsar)')
  const fixtureBuild = source.indexOf('createMcpFixturePackage(executable, mcpStdioSmokePatches())')
  const firstLaunch = source.indexOf('launchPackagedDesktop(fixture?.executable ?? executable, profile)')
  assert.ok(nativeHash >= 0 && fixtureBuild > nativeHash && firstLaunch > fixtureBuild,
    'the original ASAR hash is captured before any fixture build or app launch')
  assert.equal(source.split('launchPackagedDesktop(fixture?.executable ?? executable, profile)').length - 1, 3,
    'initial startup and both relaunches use the original executable in native-review mode')
  assert.match(source, /if \(!nativeReview\)\s*fixture = await createMcpFixturePackage\(executable, mcpStdioSmokePatches\(\)\)/)

  const clearEnv = source.indexOf('for (const key of ENV_KEYS) delete process.env[key]')
  const fixtureGate = source.indexOf("process.env[GATE] = '1'")
  assert.ok(clearEnv >= 0 && fixtureGate > clearEnv)
  const setupBeforeFixture = source.slice(clearEnv, fixtureBuild)
  assert.match(setupBeforeFixture, /if \(!nativeReview\)\s*\{[^}]*process\.env\[GATE\] = '1'/s,
    'fixture approval and launch environment are assigned only inside fixture mode')

  assert.match(source, /const WAIT = 30_000/)
  const reviewClicks = [...source.matchAll(/setup\.getByRole\('button', \{ name: 'Review & inspect', exact: true \}\)\.click\(\{ timeout: WAIT \}\)/g)]
  assert.equal(reviewClicks.length, 2, 'both native review actions retain the original 30-second bound')
  const markers = [...source.matchAll(/native-review-ready/g)].map(match => match.index)
  assert.equal(markers.length, 2, 'native review prints separate readiness markers for Cancel and fresh Allow')
  const firstClick = reviewClicks[0].index
  const secondClick = reviewClicks[1].index
  assert.ok(markers[0] < firstClick && markers[1] < secondClick)
  const cancellation = source.slice(firstClick, secondClick)
  for (const required of [
    'data-mcp-stdio-phase="cancelled"',
    'assert.deepEqual(await api(page, `/mcp-connections/${connectionId}`), connection',
    'assert.deepEqual(await peerTrace(tracePath), []',
    "name: 'Close', exact: true",
    'setup = await configure()',
  ]) assert.ok(cancellation.includes(required), `native Cancel must be proved before fresh review: ${required}`)
  const noLaunch = source.match(/const assertNoLaunch = async \(\) => \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(noLaunch, 'launch-boundary assertions are kept in a named helper')
  assert.match(noLaunch, /assert\.rejects\(readFile\(tracePath\), \{ code: 'ENOENT' \}/)
  assert.match(noLaunch, /assert\.rejects\(readFile\(ownerGrant\), \{ code: 'ENOENT' \}/)
  const noLaunchCalls = [...source.matchAll(/await assertNoLaunch\(\)/g)].map(match => match.index)
  assert.equal(noLaunchCalls.length, 2, 'launch custody is checked both before review and after cancellation')
  assert.ok(noLaunchCalls[0] < firstClick && noLaunchCalls[1] > firstClick && noLaunchCalls[1] < secondClick)

  const evidenceWrite = source.indexOf("writeFile(join(evidence, 'evidence.json')")
  const preEvidenceGuard = source.lastIndexOf('await assertOriginalPackageUnmodified()', evidenceWrite)
  assert.ok(evidenceWrite > 0 && preEvidenceGuard >= nativeHash && preEvidenceGuard < evidenceWrite,
    'source ASAR guard is invoked before writing success evidence')
  assert.match(source, /const assertOriginalPackageUnmodified = async \(\) => \{\s*assert\.equal\(await asarSha256\(sourceAsar\), sourceAsarSha256,/,
    'the integrity guard compares the current source ASAR against its initial digest')
  const finalCleanup = source.indexOf('await assertOriginalPackageUnmodified()', evidenceWrite)
  assert.ok(finalCleanup > evidenceWrite, 'source ASAR integrity is rechecked after the workflow for cleanup-time evidence')
  assert.ok(finalCleanup > source.indexOf('await fixture?.close()', evidenceWrite),
    'final source-ASAR verification occurs after disposable fixture cleanup')
  const modeEvidence = source.slice(evidenceWrite, source.indexOf('console.log(`[desktop-agent-request-smoke]', evidenceWrite))
  assert.match(modeEvidence, /mode: nativeReview \? 'native-review' : 'fixture-dialogs'/)
  assert.match(modeEvidence, /scope: nativeReview\s*\?/)
  assert.match(modeEvidence, /sourceAsarSha256/)
  assert.match(modeEvidence, /originalPackagedAppUnmodified: true/)
  assert.match(source, /nativeReview \? 'actual native review' : 'fixture native review'/)
}

test('native-review Agent Requests acceptance uses the original app and distinguishes its evidence', () => {
  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  assertNativeAgentRequestReviewContract(source)
  const mutant = source.replace("if (!nativeReview) {\n    process.env[GATE] = '1'", "{\n    process.env[GATE] = '1'")
  assert.notEqual(mutant, source, 'the scoped fixture-gate mutation must reach the guarded setting')
  assert.throws(() => assertNativeAgentRequestReviewContract(mutant), assert.AssertionError,
    'a fixture approval gate outside fixture mode must break the source lock')
})

test('the Agent Requests source lock is non-vacuous for bounded native review', () => {
  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  const mutant = source.replace("setup.getByRole('button', { name: 'Review & inspect', exact: true }).click({ timeout: WAIT })",
    "setup.getByRole('button', { name: 'Review call', exact: true }).click()")
  assert.notEqual(mutant, source, 'the scoped mutation must find the native-review timeout guard')
  assert.throws(() => assertNativeAgentRequestReviewContract(mutant), assert.AssertionError)

  const withoutPreEvidenceGuard = source.replace('    await assertOriginalPackageUnmodified()\n    await writeFile(join(evidence, \'evidence.json\')',
    '    await writeFile(join(evidence, \'evidence.json\')')
  assert.notEqual(withoutPreEvidenceGuard, source, 'the scoped mutation removes the pre-evidence integrity invocation')
  assert.throws(() => assertNativeAgentRequestReviewContract(withoutPreEvidenceGuard), assert.AssertionError)

  const withoutPostCancelBoundary = source.replace('    await assertNoLaunch()\n    await page.screenshot({ path: join(evidence, \'native-review-cancelled.png\')',
    '    await page.screenshot({ path: join(evidence, \'native-review-cancelled.png\')')
  assert.notEqual(withoutPostCancelBoundary, source, 'the scoped mutation removes the post-Cancel no-launch proof')
  assert.throws(() => assertNativeAgentRequestReviewContract(withoutPostCancelBoundary), assert.AssertionError)

  for (const assertion of [
    "      await assert.rejects(readFile(tracePath), { code: 'ENOENT' }, 'Cancel never starts the authored child')\n",
    "      await assert.rejects(readFile(ownerGrant), { code: 'ENOENT' }, 'Cancel never publishes encrypted launch custody')\n",
  ]) {
    const withoutAbsenceProof = source.replace(assertion, '')
    assert.notEqual(withoutAbsenceProof, source, 'the scoped mutation reaches one ENOENT launch-boundary assertion')
    assert.throws(() => assertNativeAgentRequestReviewContract(withoutAbsenceProof), assert.AssertionError)
  }
})

function assertDirectReplySmokeContract(source) {
  const helper = source.match(/async function ownerDirectReply\(page, origin, requestId, reply\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(helper, 'the packaged workflow has a rendered direct-reply helper')
  for (const required of [
    "getByRole('button', { name: 'Use a tool…', exact: true })",
    "getByLabel('Inspected tool', { exact: true })).toHaveCount(0",
    "getByRole('button', { name: 'Review reply', exact: true })",
    "getByRole('button', { name: 'Share reply', exact: true })",
  ]) assert.ok(helper.includes(required), `direct-reply helper retains ${required}`)

  for (const required of [
    "directOwner.execution, undefined, 'a direct reply has no execution receipt'",
    "storedDirect.execution, undefined, 'SQLite stores the exact direct-reply lifecycle without a tool receipt'",
    'toolCalls(traceAfterDirectReply).length, directCallsBefore',
    'processStarts(traceAfterDirectReply).length, directStartsBefore',
    'assert.deepEqual(storedRequest(profile, direct.id), storedDirect',
    'recoveredDirect.execution, undefined',
    "getByRole('region', { name: 'Shared reply', exact: true })).toContainText(directReply)",
    "requester-direct-reply-after-relaunch.png",
  ]) assert.ok(source.includes(required), `packaged direct-reply evidence retains ${required}`)
}

test('direct Agent Request replies have a watched packaged no-execution persistence lock', () => {
  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  assertDirectReplySmokeContract(source)
  const mutant = source.replace(
    "    assert.equal(storedDirect.execution, undefined, 'SQLite stores the exact direct-reply lifecycle without a tool receipt')\n",
    '')
  assert.notEqual(mutant, source, 'the scoped mutation removes the SQLite no-execution receipt check')
  assert.throws(() => assertDirectReplySmokeContract(mutant), assert.AssertionError)
})

function assertReplyDraftSmokeContract(source) {
  const helper = source.match(/async function ownerDraftReply\(page, origin, requestId, \{([\s\S]*?)\n\}(?=\n)/)?.[0]
  assert.ok(helper, 'the packaged workflow has a rendered reply-draft path')
  for (const required of [
    "agent-requests/${requestId}/reply-review",
    "assert.deepEqual(supplied, { task, notes }",
    "modelRequest.tools, undefined, 'reply drafting has no tool schema'",
    "modelRequest.messages.length, 1, 'reply draft has no conversation history'",
    'the exact reviewed receiving-Agent model binding is submitted',
  ]) assert.ok(helper.includes(required), `rendered model reply drafting retains ${required}`)

  for (const required of [
    "action === 'draft-reply'",
    "name: 'Draft a reply…', exact: true",
    "Notes for a reply draft', { exact: true",
    "name: 'Draft reply', exact: true",
    "name: 'Use a tool…', exact: true",
    "name: 'Use reply draft', exact: true",
    "name: 'Replace with suggested reply', exact: true",
    "page.getByLabel('Reply', { exact: true }).fill(editedReply)",
    "name: 'Review reply', exact: true",
    "name: 'Share reply', exact: true",
    "storedReplyDraft.replyDraft, ownerWithReplyDraft.replyDraft",
    "toolCalls(replyTraceAfter).length, toolCalls(replyTraceBefore).length",
    "processStarts(replyTraceAfter).length, processStarts(replyTraceBefore).length",
    "recoveredPendingReply.replyDraft.status, 'uncertain'",
    "model.replyRequests.length, 2, 'the successful and isolated interrupted reply attempts are exact and never repeated'",
    "requesterReplyDraft.replyDraft, undefined, 'the requester cannot read the private model reply receipt'",
    "requester-edited-model-reply-after-relaunch.png",
  ]) assert.ok(source.includes(required), `packaged model reply evidence retains ${required}`)
}

test('model-written Agent Request replies have watched packaged input and relaunch locks', () => {
  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  assertReplyDraftSmokeContract(source)
  const withoutNoToolsCheck = source.replace(
    "  assert.equal(modelRequest.tools, undefined, 'reply drafting has no tool schema')\n",
    '')
  assert.notEqual(withoutNoToolsCheck, source, 'the scoped mutation removes the model no-tools assertion')
  assert.throws(() => assertReplyDraftSmokeContract(withoutNoToolsCheck), assert.AssertionError)
})

test('reply-draft interruption runs only after pending MCP and argument advice recover', () => {
  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  const dualPhase = source.indexOf("stage = 'pending-interruption-and-same-profile-relaunch-without-replay'")
  const firstRelaunch = source.indexOf('run = await launchPackagedDesktop(fixture?.executable ?? executable, profile)', dualPhase)
  const recoveredArguments = source.indexOf("assert.equal(recoveredDraft.argumentDraft.status, 'uncertain')", firstRelaunch)
  const recoveredMcp = source.indexOf("assert.equal(recovered.status, 'awaiting-reply')", recoveredArguments)
  const replyPhase = source.indexOf("stage = 'pending-reply-draft-interruption-and-second-same-profile-relaunch-without-replay'", recoveredMcp)
  const pendingReply = source.indexOf('const pendingReplyRequest = await createRequestThroughUi', replyPhase)
  const replyPendingReceipt = source.indexOf("assert.equal(pendingReplyOwner.replyDraft.status, 'pending')", pendingReply)
  const secondClose = source.indexOf('await closePackagedDesktop(run); run = undefined', replyPendingReceipt)
  const secondRelaunch = source.indexOf('run = await launchPackagedDesktop(fixture?.executable ?? executable, profile)', secondClose)
  const uncertain = source.indexOf("recoveredPendingReply.replyDraft.status, 'uncertain'", secondRelaunch)
  for (const [label, index] of [
    ['dual interruption phase', dualPhase], ['first relaunch', firstRelaunch], ['argument recovery', recoveredArguments],
    ['MCP recovery', recoveredMcp], ['isolated reply phase', replyPhase], ['pending reply receipt', replyPendingReceipt],
    ['second relaunch', secondRelaunch], ['uncertain reply recovery', uncertain],
  ]) assert.ok(index >= 0, `packaged workflow keeps ${label}`)
  assert.ok(dualPhase < firstRelaunch && firstRelaunch < recoveredArguments && recoveredArguments < recoveredMcp &&
    recoveredMcp < replyPhase && replyPhase < pendingReply && pendingReply < replyPendingReceipt &&
    replyPendingReceipt < secondClose && secondClose < secondRelaunch && secondRelaunch < uncertain,
  'reply generation starts only after both earlier workers recovered, then has its own shutdown and relaunch')
  assert.equal(source.slice(dualPhase, replyPhase).includes('pendingReplyRequest'), false,
    'no reply draft can compete with the two existing pending workers')
  const replyPhaseSource = source.slice(replyPhase, source.indexOf('const finalTrace', replyPhase))
  assert.match(replyPhaseSource, /assert\.equal\(model\.replyRequests\.length, 2, .*never repeated/)
  assert.match(replyPhaseSource, /storedRecoveredPendingReply\.replyDraft\.inputHash, pendingReplySaved\.replyDraft\.inputHash/)
  assert.match(replyPhaseSource, /assert\.deepEqual\(storedRecoveredPendingReply\.replyDraft, recoveredPendingReply\.replyDraft/)

  const withoutSecondRelaunch = source.replace(
    '    run = await launchPackagedDesktop(fixture?.executable ?? executable, profile)\n    ;({ page, origin } = run)\n    assert.equal((await api(page, \'/me\')).user.id, owner.user.id, \'the owner session also survives the isolated reply-draft relaunch\')\n',
    '')
  assert.notEqual(withoutSecondRelaunch, source, 'the scoped mutation removes the isolated second relaunch')
  const mutantSecondRelaunch = withoutSecondRelaunch.indexOf('reply-draft-interruption-and-second-same-profile-relaunch-without-replay')
  assert.ok(mutantSecondRelaunch >= 0)
  assert.throws(() => {
    const second = withoutSecondRelaunch.indexOf('run = await launchPackagedDesktop(fixture?.executable ?? executable, profile)', mutantSecondRelaunch)
    const uncertainAfter = withoutSecondRelaunch.indexOf("recoveredPendingReply.replyDraft.status, 'uncertain'", mutantSecondRelaunch)
    assert.ok(second >= 0 && second < uncertainAfter)
  }, assert.AssertionError, 'source lock rejects recovering the private draft without its dedicated relaunch')
})
