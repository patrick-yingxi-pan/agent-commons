/** Boundary contracts enforced as tests — the structural invariants that keep the
 *  UI ↔ backend seam honest, the class of drift an adversarial review caught by hand:
 *
 *   • the contract stays framework-/Node-free (so both ends import it verbatim),
 *   • contract + server stay erasable TS (the Node runtime only type-strips),
 *   • the production build's asset base agrees with the server's SPA fallback,
 *   • every declared SSE event has BOTH a server producer and a client consumer
 *     (no dead/reserved wire surface, no unhandled event),
 *   • every `*Request` DTO the contract declares is actually used by a route/command.
 *
 *  These read the repo's own source as data (see tests/helpers/source.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROOT, filesUnder, read, stripComments, concatSource } from './helpers/source.ts'
import { join } from 'node:path'
import { resolveConfig } from 'vite'
import { ignoreFromPackage } from '../desktop/packager.config.mjs'

test('local Commission execution reuses the native-gated bound executor without owning a process launcher', () => {
  const store = stripComments(read(join(ROOT, 'server/store/index.ts')))
  const hosts = store.slice(store.indexOf('const commissionMcpHost ='), store.indexOf('function backgroundModelCapacity('))
  assert.ok(hosts.startsWith('const commissionMcpHost ='))
  const check = (source: string) => {
    assert.equal(source.split('allowLocalPrograms: () => mcpRuntimeCapabilities().localProcesses === true').length - 1, 2)
    assert.match(source, /executeBoundMcpCall\(store, tenant, call, allowed, person, signal\)/)
    assert.doesNotMatch(source, /\b(?:spawn|execFile|createMcpStdioClient)\s*\(/)
  }
  check(hosts)
  assert.throws(() => check(hosts.replace('allowLocalPrograms: () => mcpRuntimeCapabilities().localProcesses === true', 'allowLocalPrograms: () => true')))
  assert.throws(() => check(`${hosts}\nspawn('local')`))
})

test('MCP argument drafting shares one portable binding contract without acquiring execution authority', () => {
  const server = stripComments(read(join(ROOT, 'server/projectWorkMcpDraft.ts')))
  const client = stripComments(read(join(ROOT, 'src/components/ContributionMcpDraftHelper.tsx')))
  for (const source of [server, client]) {
    assert.match(source, /contract\/projectWorkMcpDraft\.ts/)
    assert.match(source, /projectWorkMcpDraftBindingText\(/)
  }
  const check = (source: string) => assert.doesNotMatch(source,
    /\b(?:executeBoundMcpCall|executeContributionMcpEffect|createMcpStdioClient|spawn|recordContribution|commitMutationBatch|fetch)\s*\(/,
    'draft preparation cannot acquire tool, launch, credit or persistence authority')
  check(server)
  check(client)
  assert.throws(() => check(`${server}\nexecuteBoundMcpCall()`), /cannot acquire/)
})

test('item-first MCP publication reuses reviewed creation without execution or approval authority', () => {
  const ui = stripComments(read(join(ROOT, 'src/components/WorkItemMcpProposalPanel.tsx')))
  assert.match(ui, /enqueueContributionCreation\(/)
  assert.match(ui, /initialMcpProposal: requestSelection/)
  const store = stripComments(read(join(ROOT, 'server/store/index.ts')))
  const method = store.slice(store.indexOf('async openContributionWithInitialMcpProposal('), store.indexOf('getContributionCommentCreation('))
  assert.ok(method.startsWith('async openContributionWithInitialMcpProposal('))
  assert.match(method, /prepareContributionMcpLines\(/)
  assert.match(method, /status: 'proposed'/)
  const check = (source: string) => assert.doesNotMatch(source,
    /\b(?:executeBoundMcpCall|executeContributionMcpEffect|approveEnvelope|landContribution|recordContribution|fetch|spawn)\s*\(/,
    'reviewed publication cannot approve, execute, land, award Agent credit or perform external I/O')
  check(ui)
  check(method)
  assert.throws(() => check(`${method}\napproveEnvelope()`), /cannot approve/)
})

test('Project-work completion is a pure receipt projection separate from execution and credit', () => {
  const check = (source: string) => {
    assert.match(source, /contract\/contributions\.ts/)
    assert.match(source, /contract\/directory\.ts/)
    assert.doesNotMatch(source, /\b(?:fetch|executeBoundMcpCall|recordContribution|commitMutationBatch|persist)\s*\(/,
      'work readiness grants neither execution, persistence nor Agent credit')
  }
  const source = stripComments(read(join(ROOT, 'server/projectWorkResolution.ts')))
  check(source)
  assert.throws(() => check(`${source}\nrecordContribution('commission')`), /neither execution/)
})

// ── The built UI survives a canonical deep link ─────────────────────────────
test('form-elicitation execution is confined to the private person-consent workflow', () => {
  const allowed = new Set(['server/mcpToolCall.ts', 'server/mcpSession.ts', 'server/mcpFormToolSession.ts', 'server/mcpStdioClient.ts',
    'server/mcpBoundExecution.ts', 'server/mcpExecution.ts', 'server/routes/index.ts', 'server/routes/mcpInput.ts']
    .map(path => join(ROOT, path)))
  const symbols = /\b(?:createMcpFormToolCaller|createMcpFormSession|createMcpFormToolSession|callToolWithForms|createBoundMcpFormExecutor|createApprovedMcpFormExecutor|executeApprovedMcpFormActivity)\b/
  const check = (source: string, path: string) => assert.doesNotMatch(source, symbols,
    `${path}: form exchange requires the private person-bound consent workflow`)
  for (const directory of ['server', 'src', 'desktop']) {
    for (const path of filesUnder(directory, ['.ts', '.tsx', '.mjs', '.cjs'])) {
      if (path.endsWith('.test.mjs') || path.endsWith('.d.mts') || allowed.has(path)) continue
      check(stripComments(read(path)), path)
    }
  }
  for (const path of allowed) assert.match(stripComments(read(path)), symbols, `${path}: expected protocol owner`)
  for (const path of ['server/mcpElicitation.ts', 'server/mcpToolCall.ts']) {
    assert.match(stripComments(read(join(ROOT, path))), /from '\.\.\/contract\/mcpElicitation\.ts'/)
  }
  assert.throws(() => check('createMcpFormToolSession()', 'unexpected product caller'), /private consent|person-bound consent/)
})

test('internal stdio protocol cannot acquire launch configuration or product execution authority', () => {
  const client = stripComments(read(join(ROOT, 'server/mcpStdioClient.ts')))
  assert.match(client, /export function createMcpStdioClient/)
  assert.match(client, /open: \(options: \{ signal: AbortSignal; isCurrent: \(\) => boolean \}\)/)
  const check = (source: string) => assert.doesNotMatch(source,
    /\b(?:createMcpStdioSupervisor|snapshotMcpStdioLaunch|spawn|exec|fetch|commitMutationBatch|persist)\s*\(|node:child_process|mcpRuntime|mcpConnections|mcpBoundExecution/,
    'stream protocol cannot supply its own launch or product authority')
  check(client)
  assert.throws(() => check(`${client}\nspawn('model-selected-command')`), /launch or product authority/)
  const owners = new Set(['server/mcpStdioClient.ts', 'server/mcpConnectionInspector.ts', 'server/mcpBoundExecution.ts',
    'server/mcpRuntime.ts', 'server/routes/mcpConnections.ts'].map(path => join(ROOT, path)))
  const checkCaller = (source: string, path: string) => assert.doesNotMatch(source,
    /\bcreateMcpStdioClient\b|mcpStdioClient\.ts/, `${path}: stdio execution requires the person-bound native workflow`)
  for (const directory of ['server', 'src', 'desktop']) {
    for (const path of filesUnder(directory, ['.ts', '.tsx', '.mjs', '.cjs'])) {
      if (path.endsWith('.test.mjs') || path.endsWith('.d.mts') || owners.has(path)) continue
      checkCaller(stripComments(read(path)), path)
    }
  }
  for (const path of owners) assert.match(stripComments(read(path)), /mcpStdioClient|createMcpStdioClient/)
  assert.doesNotMatch(stripComments(read(join(ROOT, 'server/routes/mcpConnections.ts'))), /\bcreateMcpStdioClient\b/,
    'the route may sanitize protocol errors but cannot dispatch directly')
  assert.throws(() => checkCaller('createMcpStdioClient({})', 'model'), /person-bound native workflow/)
})

test('local MCP launch custody stays confined to the authenticated native workflow', () => {
  const allowed = new Set(['desktop/mcpStdioGrantVault.mjs', 'desktop/mcpStdioLaunchAuthority.mjs',
    'desktop/mcpStdioLifecycle.mjs', 'desktop/mcpStdioSource.mjs', 'desktop/mcpStdioSetup.mjs',
    'desktop/main.mjs', 'desktop/mcpStdioSmoke.mjs', 'desktop/routineMcpLocalSmoke.mjs', 'desktop/commissionMcpLocalSmoke.mjs'].map(path => join(ROOT, path)))
  const symbols = /\b(?:openMcpStdioGrantVault|createMcpStdioLaunchAuthority|snapshotMcpStdioGrantBinding)\b|mcpStdio(?:GrantVault|LaunchAuthority)\.mjs/
  const check = (source: string, path: string) => assert.doesNotMatch(source, symbols,
    `${path}: saved local launch authority requires the separate authenticated native product workflow`)
  for (const directory of ['contract', 'server', 'src', 'desktop']) {
    for (const path of filesUnder(directory, ['.ts', '.tsx', '.mjs', '.cjs'])) {
      if (path.endsWith('.test.mjs') || path.endsWith('.d.mts') || allowed.has(path)) continue
      check(stripComments(read(path)), path)
    }
  }
  for (const path of allowed) assert.match(stripComments(read(path)), symbols, `${path}: expected native custody owner`)
  for (const driver of ['desktop/mcpStdioSmoke.mjs', 'desktop/routineMcpLocalSmoke.mjs', 'desktop/commissionMcpLocalSmoke.mjs']) {
    assert.equal(ignoreFromPackage(`/${driver}`), true,
      `${driver}: the native acceptance driver must never ship as product authority`)
    assert.doesNotMatch(stripComments(read(join(ROOT, driver))),
      /\b(?:openMcpStdioGrantVault|createMcpStdioLaunchAuthority|snapshotMcpStdioGrantBinding)\b/,
      `${driver}: acceptance may inspect saved custody but cannot create or open launch authority`)
  }
  assert.throws(() => check("openMcpStdioGrantVault({ filePath: 'model-command' })", 'unexpected startup'), /authenticated native product workflow/)
})

test('Routine MCP policy and receipt preparation share portable types without owning execution or persistence', () => {
  const check = (source: string) => {
    assert.match(source, /from '\.\.\/contract\/routineMcp\.ts'/,
      'Routine MCP preparation must use the portable contract')
    assert.doesNotMatch(source, /\b(?:fetch|executeBoundMcpCall|callMcpToolWithSession|commitMutationBatch|persist)\s*\(/,
      'pure permission/receipt preparation grants neither I/O nor durable admission')
  }
  for (const path of ['server/routineMcpPolicy.ts', 'server/routineMcpState.ts']) {
    const source = stripComments(read(join(ROOT, path)))
    check(source)
    assert.throws(() => check(source.replace("from '../contract/routineMcp.ts'", "from '../server/routineRunner.ts'")), /portable contract/)
    assert.throws(() => check(`${source}\nexecuteBoundMcpCall()`), /neither I\/O nor durable admission/)
  }
})

test('Commission preparation shares portable types and tool constraints without inheriting workflow authority', () => {
  const check = (source: string) => {
    assert.match(source, /from '\.\.\/contract\/commissionMcp\.ts'/,
      'Commission preparation must use its distinct portable contract')
    assert.match(source, /from '\.\/mcpPermission\.ts'/,
      'tool constraints must have one shared implementation')
    assert.doesNotMatch(source, /\b(?:fetch|executeBoundMcpCall|callMcpToolWithSession|commitMutationBatch|persist)\s*\(/,
      'pure preparation grants neither I/O nor durable admission')
    assert.doesNotMatch(source, /\bstanding\b|from ['"][^'"]*routineMcp[^'"]*['"]/,
      'legacy standing flags and Routine policy must not supply Commission authority')
  }
  for (const path of ['server/commissionMcpPolicy.ts', 'server/commissionMcpState.ts',
    'server/commissionMcpClaim.ts', 'server/commissionMcpRegistry.ts']) {
    const source = stripComments(read(join(ROOT, path)))
    check(source)
    assert.throws(() => check(source.replace("from '../contract/commissionMcp.ts'", "from '../contract/routineMcp.ts'")), /distinct portable contract/)
    assert.throws(() => check(`${source}\nexecuteBoundMcpCall()`), /neither I\/O nor durable admission/)
    assert.throws(() => check(`${source}\nconst grant = commission.standing`), /must not supply Commission authority/)
  }
  assert.match(stripComments(read(join(ROOT, 'server/routineMcpPolicy.ts'))), /from '\.\/mcpPermission\.ts'/)
  assert.match(stripComments(read(join(ROOT, 'contract/routineMcp.ts'))), /RoutineMcpToolPermission\s*=\s*McpToolPermission/)
})

test('local unattended history is portable while execution capability remains native-owned', () => {
  const check = (snapshotHost: string, storeHost: string) => {
    assert.ok(snapshotHost.includes('validateRoutineMcpAuthorities(routineMcp, parseMcpConnectionState(state.mcpConnections), true)'),
      'snapshot admission validates local history independently of device readiness')
    assert.doesNotMatch(snapshotHost, /mcpRuntimeCapabilities|mcpRuntimeConfiguration/,
      'reading history cannot depend on live native custody')
    const gates = [...storeHost.matchAll(/allowLocalPrograms:\s*([^,\n]+)/g)].map(match => match[1])
    assert.deepEqual(gates, [...Array(2).fill('() => mcpRuntimeCapabilities().localProcesses === true'),
      ...Array(2).fill('mcpRuntimeCapabilities().localProcesses === true')],
      'Commission host/execution and Routine approval/reservation require literal native runtime capability, never request consent alone')
    assert.doesNotMatch(storeHost, /permission\.oauthAuthority\??\.ownerUserId|storedPolicy\?\.oauthAuthority/,
      'Routine person projections must use the common local/OAuth permission owner')
  }
  const snapshotHost = stripComments(read(join(ROOT, 'server/persistence/format.ts')))
  const storeHost = stripComments(read(join(ROOT, 'server/store/index.ts')))
  check(snapshotHost, storeHost)
  const mutated = snapshotHost.replace('validateRoutineMcpAuthorities(routineMcp, parseMcpConnectionState(state.mcpConnections), true)',
    'validateRoutineMcpAuthorities(routineMcp, parseMcpConnectionState(state.mcpConnections))')
  assert.notEqual(mutated, snapshotHost)
  assert.throws(() => check(mutated, storeHost), /independently of device readiness/)
  const untrusted = storeHost.replace('allowLocalPrograms: mcpRuntimeCapabilities().localProcesses === true', 'allowLocalPrograms: request.approval.localPrograms')
  assert.notEqual(untrusted, storeHost)
  assert.throws(() => check(snapshotHost, untrusted), /literal native runtime capability/)
  assert.throws(() => check(snapshotHost, `${storeHost}\nconst owner = storedPolicy?.oauthAuthority?.ownerUserId`), /common local\/OAuth permission owner/)
})

test('Contribution receipts and bound MCP execution share contract identity without session authority', () => {
  const check = (source: string) => assert.match(source, /from '\.\.\/contract\/mcpExecution\.ts'/,
    'the bound call must use the framework-free shared contract')
  for (const path of ['server/mcpBoundExecution.ts', 'server/contributionEffectState.ts']) {
    const source = stripComments(read(join(ROOT, path)))
    check(source)
    const mutated = source.replace("from '../contract/mcpExecution.ts'", "from '../server/mcpToolCall.ts'")
    assert.notEqual(mutated, source)
    assert.throws(() => check(mutated), /framework-free shared contract/)
  }
  const core = stripComments(read(join(ROOT, 'server/mcpBoundExecution.ts')))
  assert.doesNotMatch(core, /sessionContexts|ToolActivity|toolActivityDecisionIdentity/,
    'the common executor must not borrow conversation-specific authority')
  const receipt = stripComments(read(join(ROOT, 'server/contributionEffectState.ts')))
  assert.match(receipt, /from '\.\.\/contract\/contributionExecution\.ts'/)
  assert.doesNotMatch(receipt, /executeBoundMcpCall\(|callMcpToolWithSession\(|commitMutationBatch\(|persist\(/,
    'pure receipt construction grants neither execution nor durable admission')
})

test('Artifact copies share one portable body contract and no renderer source authority', () => {
  for (const path of ['server/store/index.ts', 'src/components/ArtifactContextPicker.tsx', 'src/controller/servedAttachmentRefreshCore.ts']) {
    assert.match(stripComments(read(join(ROOT, path))), /from '[^']*contract\/artifactSnapshot\.ts'/, path)
  }
  const panel = stripComments(read(join(ROOT, 'src/components/ArtifactContextPanel.tsx')))
  assert.match(panel, /body=\{snapshot\.body\}/)
  assert.match(panel, /artifactSnapshotText\(snapshot\)/)
  assert.doesNotMatch(panel, /useArtifactContent|\bfetch\(|apiGet|textSnapshot:/)
  const adapter = stripComments(read(join(ROOT, 'src/components/SessionArtifactContextPanel.tsx')))
  assert.match(adapter, /refreshServedAttachment\(sessionId, item\)/)
  assert.doesNotMatch(adapter, /readFs|useArtifactContent|artifactContent\(/)
})

test('conversation downloads share one portable descriptor and never bypass the authorized read door', () => {
  for (const path of ['server/sessionExport.ts', 'src/api/conversationExport.ts', 'src/lib/conversationExport.ts']) {
    assert.match(stripComments(read(join(ROOT, path))), /from '[^']*contract\/conversationExport\.ts'/, path)
  }
  const api = stripComments(read(join(ROOT, 'src/api/conversationExport.ts')))
  assert.match(api, /apiGet<ConversationExport>\(paths\.sessionExport\(id\), \{ signal \}\)/)
  assert.doesNotMatch(api, /\bpeek\(|localStorage|sessionStorage/)
  const dialog = stripComments(read(join(ROOT, 'src/components/ConversationDownload.tsx')))
  assert.doesNotMatch(dialog, /fetch\(|\/v1\/|\.messages|compactedMessages/)
})

test('image OCR shares its native contract without gaining HTTP, model, file-path or save authority', () => {
  for (const file of ['desktop/imageOcr.mjs', 'desktop/imageOcrHost.mjs', 'src/api/desktopImageOcr.ts']) {
    const source = stripComments(read(join(ROOT, file)))
    assert.match(source, /from ['"][.\/]+contract\/imageOcr\.mjs['"]/, file)
  }
  const adapter = stripComments(read(join(ROOT, 'src/api/desktopImageOcr.ts')))
  const review = stripComments(read(join(ROOT, 'src/lib/artifactImageImport.ts')))
  assert.doesNotMatch(adapter + review, /\bfetch\s*\(|\bpaths\.|localStorage|sessionStorage|imageOriginal|enqueueArtifactCreation/)
  assert.match(review, /await recognize\(bytes, signal\)/)
  assert.match(stripComments(read(join(ROOT, 'src/api/desktopCredentials.ts'))), /imageOcr\?: NativeImageOcrBridge/)
})

test('scanned-PDF OCR is a bounded macOS Document review seam, separate from ordinary PDF projection', () => {
  const contract = stripComments(read(join(ROOT, 'contract/pdfOcr.mjs')))
  const runner = stripComments(read(join(ROOT, 'desktop/pdfOcr.mjs')))
  const host = stripComments(read(join(ROOT, 'desktop/pdfOcrHost.mjs')))
  const broker = stripComments(read(join(ROOT, 'desktop/native/pdf-ocr-broker.m')))
  const service = stripComments(read(join(ROOT, 'desktop/native/pdf-ocr-service.m')))
  const engine = stripComments(read(join(ROOT, 'desktop/native/pdf-ocr.m')))
  const adapter = stripComments(read(join(ROOT, 'src/api/desktopPdfOcr.ts')))
  const review = stripComments(read(join(ROOT, 'src/lib/artifactPdfOcrImport.ts')))
  const ui = stripComments(read(join(ROOT, 'src/components/ArtifactDocumentImport.tsx')))

  assert.match(runner, /from '\.\.\/contract\/pdfOcr\.mjs'/)
  assert.match(host, /from '\.\.\/contract\/pdfOcr\.mjs'/)
  assert.match(adapter, /from '\.\.\/\.\.\/contract\/pdfOcr\.mjs'/)
  for (const [name, value] of [
    ['PDF_OCR_MAX_INPUT_BYTES', '8 * 1024 * 1024'],
    ['PDF_OCR_MAX_PAGES', '100'],
    ['PDF_OCR_MAX_EDGE', '2_000'],
    ['PDF_OCR_MAX_TEXT_BYTES', '64 * 1024'],
    ['PDF_OCR_TIMEOUT_MS', '120_000'],
    ['PDF_OCR_CAPACITY', '1'],
  ]) assert.match(contract, new RegExp(`export const ${name} = ${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

  function assertByteAdapter(source) {
    assert.match(source, /snapshotPdfOcrInput\(pdf\)/, 'PDF OCR adapter must snapshot and bound selected bytes')
    assert.match(source, /runDesktopOcrOperation\(/)
    assert.match(source, /timeoutMs: ADAPTER_TIMEOUT_MS/)
  }
  assertByteAdapter(adapter)
  const unboundedAdapter = adapter.replace('snapshotPdfOcrInput(pdf)', 'pdf')
  assert.notEqual(unboundedAdapter, adapter, 'the in-memory regression mutation must change the adapter')
  assert.throws(() => assertByteAdapter(unboundedAdapter), /must snapshot and bound selected bytes/)

  assert.match(runner, /targetPlatform !== 'darwin'/, 'PDF OCR is unavailable outside macOS')
  assert.match(broker, /fread\([\s\S]*stdin/)
  assert.match(broker, /ACPeerRequirement\(/)
  assert.doesNotMatch(broker, /CoreGraphics|Vision/, 'the stdin broker does not parse documents')
  assert.match(service, /effectiveUserIdentifier/)
  assert.match(service, /ACRecognizePdf\(input\)/)
  assert.match(engine, /CGPDFDocumentGetNumberOfPages/)
  assert.match(engine, /CGPDFPageGetDrawingTransform/)
  assert.match(engine, /VNRecognizeTextRequestRevision3/)
  assert.match(engine, /kMaximumAggregatePixels/)
  assert.match(engine, /\[Page %zu\]/)

  assert.match(review, /await recognize\(file\.pdfOcrInput, signal\)/)
  assert.match(review, /Your draft is unchanged/)
  assert.match(ui, /Extract PDF text/)
  assert.match(ui, /Nothing is saved until you create the document/)
  assert.doesNotMatch(adapter + review, /\bfetch\s*\(|\bpaths\.|localStorage|sessionStorage|enqueueArtifactCreation/)
  assert.doesNotMatch(concatSource('server'), /\b(?:pdfOcr|PdfOcr|PDF_OCR)\b/,
    'the review-only OCR seam adds no HTTP or MCP server operation')
})

test('production assets are root-absolute so the SPA fallback can boot nested canonical URLs', async () => {
  // `server/index.ts` deliberately serves dist/index.html for a route such as
  // `/projects/p-insights`. With a relative Vite base (`./`), that HTML asks
  // the browser for `/projects/assets/...` and the app stays blank: client-side
  // navigation works, while the same canonical URL pasted or refreshed does
  // not. Resolve the REAL build config rather than scanning its source so this
  // lock follows Vite's own interpretation of the value.
  const config = await resolveConfig({ configFile: join(ROOT, 'vite.config.ts') }, 'build')
  assert.equal(
    config.base,
    '/',
    'the same-origin deploy shape needs root-absolute assets; a relative base breaks every nested SPA fallback',
  )
})

// ── The contract is portable: framework-free and Node-free ───────────────────
test('contract/ imports only other contract modules — no React, no node:, no UI deps', () => {
  const offenders = []
  for (const file of filesUnder('contract', ['.ts', '.tsx', '.mjs'])) {
    const src = stripComments(read(file))
    for (const m of src.matchAll(/(?:\bfrom\s+|^\s*import\s+|\bimport\s*\()'([^']+)'/gm)) {
      const spec = m[1]
      const ok = spec.startsWith('./') || spec.startsWith('../contract/')
      if (!ok) offenders.push(`${file.replace(ROOT, '')} imports '${spec}'`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `contract runtime modules must import only sibling contract modules (they are imported verbatim by ` +
      `both the Vite UI and the Node server): ${offenders.join('; ')}`,
  )
})

// ── The Node runtime only type-strips: contract + server must be erasable TS ──
test('contract/ + server/ use only erasable TypeScript (no enum / namespace / param-property / decorator)', () => {
  const offenders = []
  for (const dir of ['contract', 'server']) {
    for (const file of filesUnder(dir)) {
      // NB: `filesUnder` already excludes the suites and testkit — they are not
      // the shipped runtime surface, and a suite proves its own erasability by
      // RUNNING. Without that, the prose-level regexes below flag "namespace"
      // wherever it is domain vocabulary (the identity model), which is most
      // assertion messages in this repo.
      const src = stripComments(read(file))
      const rel = file.replace(ROOT, '')
      if (/\benum\s+[A-Za-z_]/.test(src)) offenders.push(`${rel}: enum`)
      if (/\bnamespace\s+[A-Za-z_]/.test(src)) offenders.push(`${rel}: namespace`)
      if (/constructor\s*\([^)]*\b(?:private|public|protected|readonly)\s+[A-Za-z_]/.test(src))
        offenders.push(`${rel}: constructor parameter property`)
      if (/^\s*@[A-Za-z_]\w*/m.test(src)) offenders.push(`${rel}: decorator`)
    }
  }
  assert.deepEqual(offenders, [], `non-erasable syntax breaks the type-stripping Node runtime: ${offenders.join('; ')}`)
})

test('the server runtime imports only its model client, export-only ZIP writer, and isolated schema validator', () => {
  const externals = new Set<string>()
  for (const file of filesUnder('server', ['.ts', '.tsx', '.mjs', '.cjs'])) {
    const src = stripComments(read(file))
    for (const match of src.matchAll(/(?:\bfrom\s+|^\s*import\s+|\bimport\s*\()'([^']+)'/gm)) {
      const specifier = match[1]
      if (!specifier.startsWith('.') && !specifier.startsWith('node:')) externals.add(specifier)
      if (specifier.startsWith('ajv') || specifier === 'fast-uri' || specifier === 'json-schema-traverse') {
        assert.equal(file, join(ROOT, 'server/mcpSchemaWorker.mjs'), 'untrusted schemas and their references resolve only in the terminable worker')
      }
    }
  }
  assert.deepEqual(
    [...externals].sort(),
    ['@anthropic-ai/sdk', '@zip.js/zip.js/lib/zip-core-custom.js', 'ajv/dist/2020.js', 'fast-uri', 'json-schema-traverse'],
    'server runtime dependencies are a deliberate boundary; add one only with an explicit invariant update',
  )
})

// ── Seeds import contract types, never re-declare them ───────────────────────
test('both model transports share server-owned attachment serialization and the UI shares its budget', () => {
  for (const path of ['server/generate.ts', 'server/relay.ts']) {
    const source = stripComments(read(join(ROOT, path)))
    assert.match(source, /attachmentPrompt\(text, session\.attachments, session\.images, /)
    assert.match(source, /input\.userText/)
    assert.match(source, /input\.systemAddition/)
  }
  assert.match(stripComments(read(join(ROOT, 'server/routes/index.ts'))), /attachments: workspaceInputAttachments\(known\.workspace\)/)
  assert.match(stripComments(read(join(ROOT, 'server/attachmentInput.ts'))), /planAttachmentInput\(attachments\)/)
  for (const path of ['src/components/Composer.tsx', 'src/components/AttachmentPanel.tsx']) {
    assert.match(stripComments(read(join(ROOT, path))), /from '[^']*contract\/attachmentInput\.ts'/)
  }
})

test('recursive folder capture stays explicit and confined to the packaged macOS native host', () => {
  const compact = (source: string) => stripComments(source).replace(/\s+/g, ' ')
  const main = compact(read(join(ROOT, 'desktop/main.mjs')))
  const checkInjection = (source: string) => assert.ok(source.includes(
    "...(process.platform === 'darwin' ? { captureTree: (root, options) => readLocalFolderTree(root, { ...options, executable: gitFileExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath }), }),",
  ), 'recursive folder injection must be macOS-only and use the bundled packaged helper')
  checkInjection(main)
  const removedLink = main.replace('captureTree: (root, options) => readLocalFolderTree(root, {', 'captureTree: (root, options) => readLocalFolderSnapshot(root, {')
  assert.notEqual(removedLink, main)
  assert.throws(() => checkInjection(removedLink), /macOS-only and use the bundled packaged helper/)

  const adapter = stripComments(read(join(ROOT, 'src/api/localFolders.ts')))
  const start = adapter.indexOf('export async function captureLocalFolder(')
  assert.ok(start > 0, 'the explicit capture adapter exists')
  assert.doesNotMatch(adapter.slice(0, start), /\.snapshotTree\s*\(/, 'listing and availability cannot start recursive reads')
  assert.equal([...adapter.matchAll(/\.snapshotTree\s*\(/g)].length, 1, 'only explicit capture invokes the recursive bridge')
  assert.ok(compact(adapter.slice(start)).includes(
    "if (captureScope === 'recursive') { if (typeof port.snapshotTree !== 'function') throw new Error('Recursive folder refresh is unavailable on this device. The saved copy is unchanged.') result = await port.snapshotTree(id, identity.source)",
  ), 'recursive capture requires an explicit scope and the source-bound optional bridge')
  assert.doesNotMatch(adapter, /['"](?:node:)?(?:fs|child_process)(?:\/[^'"]*)?['"]|\b(?:readFile|readdir|opendir|spawn)\s*\(/,
    'the folder adapter has no Node filesystem or helper-process authority')
  const checkPortable = (source: string, path: string) => assert.doesNotMatch(source,
    /\b(?:readLocalFolderTree|listLocalFolderTree|readGitFile)\b|desktop\/(?:localFolderTree|gitFileRead)\.mjs/,
    `${path}: portable surfaces cannot import or call native folder readers`)
  for (const directory of ['src', 'server']) {
    for (const path of filesUnder(directory, ['.ts', '.tsx', '.mjs', '.cjs'])) checkPortable(stripComments(read(path)), path)
  }
  assert.throws(() => checkPortable("import { readLocalFolderTree } from '../desktop/localFolderTree.mjs'", 'server'), /cannot import or call native folder readers/)
})

test('Git browse shares a portable parser contract while native listing and reads stay macOS-hosted', () => {
  const portable = concatSource('contract') + '\n' + concatSource('server') + '\n' + concatSource('src')
  assert.doesNotMatch(portable, /from\s+['"][^'"]*(?:desktop\/localGitReader|localGitReader\.mjs)['"]|node:child_process/,
    'portable code cannot import the native Git reader or its process authority')

  const parserModule = stripComments(read(join(ROOT, 'contract/localGitBrowse.mjs')))
  for (const parser of ['isLocalGitFileSelection', 'parseLocalGitFileListing', 'parseLocalGitFilePreview']) {
    assert.match(parserModule, new RegExp(`export function ${parser}\\b`), `${parser} belongs to the portable contract`)
  }
  for (const path of ['src/api/localGit.ts', 'desktop/localConnectionStore.mjs', 'desktop/localConnectionHost.mjs']) {
    const source = stripComments(read(join(ROOT, path)))
    assert.match(source, /from ['"][^'"]*contract\/localGitBrowse\.mjs['"]/, `${path} uses the shared parser module`)
    for (const parser of ['parseLocalGitFileListing', 'parseLocalGitFilePreview']) {
      assert.match(source, new RegExp(`\\b${parser}\\(`), `${path} validates with ${parser}`)
    }
  }

  const main = stripComments(read(join(ROOT, 'desktop/main.mjs')))
  const setupStart = main.indexOf("if (process.platform === 'darwin') {\n    try {\n      const gitExecutable")
  const setupEnd = main.indexOf('  let providerCredentials = {}', setupStart)
  assert.ok(setupStart >= 0 && setupEnd > setupStart, 'the native Git setup block is present')
  const setup = main.slice(setupStart, setupEnd)
  assert.match(setup, /if \(process\.platform === 'darwin'\)/)
  assert.match(setup, /browse: reader\.listLocalGitFiles/)
  assert.match(setup, /preview: reader\.readLocalGitFile/)
  assert.match(setup, /connectionKind: 'git'/)
  const installStart = main.indexOf('function installLocalGitIpc() {')
  const installEnd = main.indexOf('\nfunction installImageOcrIpc()', installStart)
  assert.ok(installStart >= 0 && installEnd > installStart, 'the local Git IPC installer is present')
  const installer = main.slice(installStart, installEnd)
  assert.match(installer, /if \(process\.platform !== 'darwin'\) return/)
  assert.match(installer, /Object\.entries\(localGitChannels\)/)
  assert.match(installer, /localGitHost\[name\]\(event, \.\.\.args\)/)
  const checkPlatformGuard = (source: string) => assert.match(source, /if \(process\.platform !== 'darwin'\) return/)
  assert.throws(() => checkPlatformGuard(installer.replace('if (process.platform !== \'darwin\') return', '')), assert.AssertionError)
})

test('untracked Git browsing has distinct shared parsers and no tracked-channel widening', () => {
  const parserModule = stripComments(read(join(ROOT, 'contract/localGitUntrackedBrowse.mjs')))
  const parsers = ['parseLocalGitUntrackedFilesRequest', 'parseLocalGitUntrackedFileRequest',
    'parseLocalGitUntrackedFileListing', 'parseLocalGitUntrackedFilePreview']
  for (const parser of parsers) assert.ok(parserModule.includes(`export function ${parser}(`), `${parser} is contract-owned`)
  for (const path of ['src/api/localGit.ts', 'desktop/localConnectionStore.mjs', 'desktop/localConnectionHost.mjs']) {
    const source = stripComments(read(join(ROOT, path)))
    assert.ok(source.includes('contract/localGitUntrackedBrowse.mjs'), `${path} imports the shared untracked contract`)
    for (const parser of parsers) {
      const delegated = path === 'src/api/localGit.ts' && ['parseLocalGitUntrackedFileListing', 'parseLocalGitUntrackedFilePreview'].includes(parser)
      assert.ok(source.includes(delegated ? `}, ${parser}` : `${parser}(`), `${path} uses ${parser}`)
      if (delegated) assert.ok(source.includes('const detached = parse(result)'), 'shared native-read helper runs its result parser')
    }
  }
  const main = stripComments(read(join(ROOT, 'desktop/main.mjs')))
  assert.ok(main.includes('browseUntracked: reader.listLocalGitUntrackedFiles'), 'explicit untracked listing wires to its own reader')
  assert.ok(main.includes('previewUntracked: reader.readLocalGitUntrackedFile'), 'explicit untracked preview wires to its own reader')
  assert.ok(main.includes('browse: reader.listLocalGitFiles') && main.includes('preview: reader.readLocalGitFile'), 'tracked channels retain their original readers')
  const contract = stripComments(read(join(ROOT, 'contract/localGitCapture.ts')))
  for (const method of ['untrackedFiles', 'untrackedFile', 'cancelUntrackedRead']) assert.ok(contract.includes(`${method}(`), `${method} remains a distinct bridge capability`)
})

test('selective folder browse shares its portable contract while descriptor listing/read IPC stays macOS-only', () => {
  const portable = concatSource('contract') + '\n' + concatSource('server') + '\n' + concatSource('src')
  assert.doesNotMatch(portable, /from\s+['"][^'"]*(?:desktop\/(?:localFolderReader|gitFileRead|localFolderTree)|localFolderReader\.mjs)['"]|\blistLocalFolderTree\s*\(/,
    'portable UI/server code cannot import or invoke the native descriptor reader')

  const parserModule = stripComments(read(join(ROOT, 'contract/localFolderBrowse.mjs')))
  for (const parser of ['isLocalFolderFileSelection', 'parseLocalFolderFileListing', 'parseLocalFolderFilePreview']) {
    assert.match(parserModule, new RegExp(`export function ${parser}\\b`), `${parser} belongs to the portable contract`)
  }
  for (const path of ['src/api/localFolders.ts', 'desktop/localConnectionStore.mjs', 'desktop/localConnectionHost.mjs']) {
    const source = stripComments(read(join(ROOT, path)))
    assert.match(source, /from ['"][^'"]*contract\/localFolderBrowse\.mjs['"]/, `${path} uses the shared parser module`)
    for (const parser of ['parseLocalFolderFileListing', 'parseLocalFolderFilePreview']) {
      assert.match(source, new RegExp(`\\b${parser}\\(`), `${path} validates with ${parser}`)
    }
  }

  const main = stripComments(read(join(ROOT, 'desktop/main.mjs')))
  assert.match(main, /browseFiles: \(root, options\) => readLocalFolderFiles\(root/)
  assert.match(main, /previewFile: \(root, selection, options\) => readLocalFolderFile\(root, selection/)
  const preload = stripComments(read(join(ROOT, 'desktop/preload.cjs')))
  const checkMacOnly = (source: string) => assert.match(source,
    /\.\.\.\(process\.platform === 'darwin' \? \{\s*files: \(id, source\) => invokeLocalFolder\(localFolderChannels\.files, id, source\),\s*file: \(id, selection, source\) => invokeLocalFolder\(localFolderChannels\.file, id, selection, source\)/,
    'native browse methods exist only in the fixed macOS bridge surface')
  checkMacOnly(preload)
  const removedPlatformGuard = preload.replace("...(process.platform === 'darwin' ? {\n        files:", "...(true ? {\n        files:")
  assert.notEqual(removedPlatformGuard, preload)
  assert.throws(() => checkMacOnly(removedPlatformGuard), /fixed macOS bridge surface/)
})

test('browser and native selected-file intake share one portable text policy', () => {
  for (const path of ['desktop/contextPicker.mjs', 'src/lib/uiHostFs.ts']) {
    const source = stripComments(read(join(ROOT, path)))
    assert.match(source, /from '[^']*contract\/localTextFile\.mjs'/, `${path} uses the shared runtime policy`)
    assert.match(source, /isLocalTextFileName\(/)
    assert.match(source, /decodeLocalTextPreview\(bytes\)/)
    assert.doesNotMatch(source, /const TEXT_EXT(?:S|ENSIONS)\s*=/, `${path} cannot maintain a parallel format list`)
  }
})

test('local images cross one bounded normalization, upload, and immutable reference seam', () => {
  const intake = stripComments(read(join(ROOT, 'src/lib/uiHostFs.ts')))
  const prepare = stripComments(read(join(ROOT, 'src/controller/imageAttachments.ts')))
  const picker = stripComments(read(join(ROOT, 'src/components/UiHostDropZone.tsx')))
  const routes = stripComments(read(join(ROOT, 'server/routes/index.ts')))
  assert.match(intake, /importImage\(/)
  assert.doesNotMatch(intake, /createObjectURL/)
  assert.match(prepare, /imageInput/)
  assert.match(prepare, /await .*upload\(/)
  assert.match(picker, /const issuedAccount = accountGeneration\(\)/)
  assert.match(picker, /accountGeneration\(\) !== issuedAccount/)
  assert.match(picker, /await prepareUiHostFiles\(/)
  assert.match(routes, /imageReferencesAttachable\(ws\.attachments, params\.id, tenantId\)/)
  assert.match(routes, /images: store\.sessionImageInput\(known\.id\)/)
})

test('private image originals share one upload contract and never become model input authority', () => {
  const intake = stripComments(read(join(ROOT, 'src/lib/uiHostFs.ts')))
  const served = stripComments(read(join(ROOT, 'src/controller/servedImageCapture.ts')))
  const prepare = stripComments(read(join(ROOT, 'src/controller/imageAttachments.ts')))
  const routes = stripComments(read(join(ROOT, 'server/routes/index.ts')))
  const download = stripComments(read(join(ROOT, 'src/lib/imageOriginalDownload.ts')))
  for (const source of [intake, served]) assert.match(source, /from '[^']*contract\/imageOriginal\.ts'/)
  assert.match(prepare, /imageAssetRefMatches\(image, file\.imageInput, file\.imageOriginal\)/)
  assert.match(routes, /r\.intrinsicGet\('\/image-assets\/:id\/original'/)
  assert.ok(download.includes("mediaType: 'application/octet-stream'"), 'source containers remain download-only')
  assert.match(download, /file\.id !== ref\.id/)
  assert.match(download, /file\.original\.byteLength !== ref\.originalByteLength/)
  assert.match(stripComments(read(join(ROOT, 'server/attachmentInput.ts'))), /imageAssetPreviewMatches/)
})

test('Office parsing stays lazy, shared, worker-only, and resource-free', () => {
  const workerLifecycle = stripComments(read(join(ROOT, 'src/lib/documentWorkerImport.ts')))
  assert.match(workerLifecycle, /export function createDocumentWorkerImporter/)
  assert.match(workerLifecycle, /worker\.terminate\(\)/)
  assert.match(workerLifecycle, /Promise\.resolve\(\)\.then\(load\)/)
  assert.match(workerLifecycle, /postMessage\(\{ format, bytes: snapshot \}/)

  const pipelines = [
    ['docx', 'docxImport.ts'],
    ['xlsx', 'xlsxImport.ts'],
    ['xlsx-workbook', 'workbookImport.ts'],
    ['pptx', 'pptxImport.ts'],
    ['pptx-presentation', 'presentationImport.ts'],
  ] as const
  for (const [format, intakeName] of pipelines) {
    const intake = stripComments(read(join(ROOT, 'src/lib', intakeName)))
    assert.match(intake, /createDocumentWorkerImporter/)
    assert.ok(intake.includes("import('./officeParser.worker.ts?worker')"), `${format} worker must remain lazy`)
    assert.ok(intake.includes(`format: '${format}'`), `${format} importer must bind its parser format`)
    assert.doesNotMatch(stripComments(read(join(ROOT, 'src/lib', intakeName))), /\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\b|\bfrom\s+['"]node:/)
  }

  const officeWorker = stripComments(read(join(ROOT, 'src/lib/officeParser.worker.ts')))
  for (const extraction of ['docxExtraction.ts', 'xlsxExtraction.ts', 'pptxExtraction.ts']) {
    assert.ok(officeWorker.includes(`from './${extraction}'`))
  }
  assert.ok(officeWorker.includes('extractDocx(') && officeWorker.includes('extractXlsx('))
  assert.ok(officeWorker.includes("value.format === 'docx'") && officeWorker.includes("value.format === 'xlsx'"))
  assert.ok(officeWorker.includes('extractPptx(') && officeWorker.includes("value.format === 'pptx'"))
  assert.ok(officeWorker.includes('extractPresentation(') && officeWorker.includes("value.format === 'pptx-presentation'"))
  assert.ok(officeWorker.includes('extractWorkbook(') && officeWorker.includes("value.format === 'xlsx-workbook'"))
  const workbook = stripComments(read(join(ROOT, 'src/lib/workbookImport.ts')))
  assert.ok(workbook.includes('acceptedResult: parseWorkbookImportResult'), 'workbook worker results cross the closed structural validator')
  const presentation = stripComments(read(join(ROOT, 'src/lib/presentationImport.ts')))
  assert.ok(presentation.includes('acceptedResult: parsePresentationImportResult'), 'worker data passes the shared closed structural validator')
  const mapping = stripComments(read(join(ROOT, 'src/lib/artifactPresentationImport.ts')))
  assert.ok(mapping.includes('parsePresentationSnapshot(file.presentation)'), 'authoring maps real source structure, never flattened attachment text')
  assert.ok(mapping.includes('parseStructuredArtifactBody({ type: \'slides\', slides })'), 'imports reuse the ordinary authored-body contract')
  assert.doesNotMatch(mapping, /file\.text/)

  const officePackage = stripComments(read(join(ROOT, 'src/lib/officePackage.ts')))
  assert.ok(officePackage.includes("from '@zip.js/zip.js/lib/zip-core-custom.js'"))
  assert.ok(officePackage.includes("from 'saxes'"))
  for (const required of ['strictness: \'strict\'', 'useWebWorkers: false', 'useCompressionStream: true', 'checkCrc32: true', 'checkOverlappingEntry: true']) {
    assert.ok(officePackage.includes(required), `Office archive policy must retain ${required}`)
  }
  assert.match(officePackage, /export function parseOfficeXml/)
  assert.match(officePackage, /export async function readOfficePackage/)
  for (const path of ['src/lib/officePackage.ts', 'src/lib/officeParser.worker.ts', 'src/lib/docxExtraction.ts', 'src/lib/docxText.ts', 'src/lib/xlsxExtraction.ts', 'src/lib/xlsxText.ts', 'src/lib/pptxExtraction.ts', 'src/lib/pptxText.ts']) {
    assert.doesNotMatch(stripComments(read(join(ROOT, path))), /\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\b|\bfrom\s+['"]node:/, `${path} cannot resolve document resources outside its package`)
  }

  const officeOwned = new Set([
    'src/lib/officePackage.ts', 'src/lib/officeParser.worker.ts', 'src/lib/docxExtraction.ts', 'src/lib/docxText.ts',
    'src/lib/xlsxExtraction.ts', 'src/lib/xlsxText.ts',
    'src/lib/pptxExtraction.ts', 'src/lib/pptxText.ts',
    'src/lib/svgExtraction.ts',
  ])
  for (const directory of ['desktop', 'server', 'src']) {
    for (const file of filesUnder(directory, ['.ts', '.tsx', '.mjs'])) {
      const relative = file.slice(ROOT.length + 1)
      if (officeOwned.has(relative)) continue
      if (relative === 'server/artifactOfficeZip.ts') {
        const writer = stripComments(read(file))
        assert.ok(writer.includes("import { ZipWriter, TextReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-custom.js'"))
        assert.doesNotMatch(writer, /\b(?:ZipReader|fetch|XMLHttpRequest|WebSocket|importScripts|readFile|saxes)\b/)
        assert.ok(writer.includes('level: 0, useWebWorkers: false'))
        assert.ok(writer.includes('dataDescriptor: false'))
        continue
      }
      if (relative === 'server/artifactXlsx.ts' || relative === 'server/artifactPptx.ts' || relative === 'server/artifactDocx.ts') {
        const serializer = stripComments(read(file))
        assert.match(serializer, /import \{ writeOfficeZip \} from '\.\/artifactOfficeZip\.ts'/)
        assert.doesNotMatch(serializer, /\b(?:ZipReader|ZipWriter|fetch|XMLHttpRequest|WebSocket|importScripts|readFile|saxes)\b/)
        continue
      }
      if (relative === 'desktop/attachmentSmoke.mjs') {
        assert.equal(ignoreFromPackage(`/${relative}`), true, 'acceptance ZIP parsing never ships in the native runtime')
        continue
      }
      assert.doesNotMatch(stripComments(read(file)), /\bfrom\s+['"](?:@zip\.js\/zip\.js|saxes|[^'"]*(?:officePackage|docxExtraction|docxText|xlsxExtraction|xlsxText|pptxExtraction|pptxText))/, `${relative} cannot import Office parsing outside its workers`)
    }
  }
})

test('SVG markup stays in a bounded XML worker and reaches the renderer only as a detached image', () => {
  const importer = stripComments(read(join(ROOT, 'src/lib/svgImport.ts')))
  assert.ok(importer.includes("import('./officeParser.worker.ts?worker')"))
  assert.ok(importer.includes("format: 'svg'"))
  assert.ok(importer.includes('acceptedResult: parseSvgPreparation'))
  const worker = stripComments(read(join(ROOT, 'src/lib/officeParser.worker.ts')))
  assert.ok(worker.includes("value.format === 'svg'"))
  assert.ok(worker.includes('extractSvg(value.bytes)'))
  const parser = stripComments(read(join(ROOT, 'src/lib/svgExtraction.ts')))
  assert.ok(parser.includes("from 'saxes'"))
  const image = stripComments(read(join(ROOT, 'src/lib/svgImage.ts')))
  assert.ok(image.includes('new Image()'))
  assert.ok(image.includes('URL.createObjectURL(blob)'))
  assert.ok(image.includes('URL.revokeObjectURL(url)'))
  for (const source of [parser, image, importer]) {
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|importScripts|innerHTML|outerHTML|insertAdjacentHTML|appendChild)\b/)
  }
  for (const directory of ['desktop', 'server', 'src']) {
    for (const file of filesUnder(directory, ['.ts', '.tsx', '.mjs'])) {
      if (file.endsWith('/src/lib/officeParser.worker.ts')) continue
      assert.doesNotMatch(stripComments(read(file)), /\bfrom\s+['"][^'"]*svgExtraction(?:\.ts)?['"]/, `${file} cannot parse SVG outside its worker`)
    }
  }
})

test('PDF parsing stays lazy and worker-only, with no auxiliary fetch or native-main parser', () => {
  const intake = stripComments(read(join(ROOT, 'src/lib/pdfImport.ts')))
  assert.ok(intake.includes("import('./pdfExtractor')"))
  const parser = stripComments(read(join(ROOT, 'src/lib/pdfExtractor.ts')))
  for (const required of ['new ParserWorker()', 'PDFWorker.create({ port', 'useWorkerFetch: false', 'BinaryDataFactory: NoExternalData', 'useWasm: false', 'enableXfa: false', 'port?.terminate()']) {
    assert.ok(parser.includes(required), `PDF sandbox policy must retain ${required}`)
  }
  for (const directory of ['desktop', 'server']) {
    for (const file of filesUnder(directory, ['.ts', '.mjs'])) {
      assert.ok(!stripComments(read(file)).includes("from 'pdfjs-dist"), `${file} cannot run PDF parsing outside the renderer worker boundary`)
    }
  }
})

// The saved-context seed satisfies the wire type `SavedContext`; it must import
// that shape from the contract, not mint a parallel copy. A hand-mirrored copy
// silently drifted once already (the `lastUsed: string` → `lastUsedAt: number`
// migration had to be applied in both places). This locks the single source of
// truth so the duplicate can't creep back. (contract/contexts.ts is canonical.)
test('the saved-context seed imports its row shape from the contract — never re-declares it', () => {
  const seed = stripComments(read(join(ROOT, 'server', 'data', 'savedContexts.ts')))

  assert.match(
    seed,
    /import\s+type\s+\{[^}]*\bSavedContext\b[^}]*\}\s+from\s+'[^']*contract\/contexts\.ts'/,
    'server/data/savedContexts.ts must import SavedContext from the contract (the single source of truth)',
  )

  for (const name of ['SavedContext', 'SavedContextKind', 'ContextStatus']) {
    assert.doesNotMatch(
      seed,
      new RegExp(String.raw`(?:export\s+)?(?:interface|type)\s+${name}\b`),
      `server/data/savedContexts.ts re-declares the contract type "${name}" — import it from ` +
        `contract/contexts.ts instead so the seed cannot drift from the wire type`,
    )
  }
})

// ── The SSE event boundary: every declared event is produced AND consumed ─────
function declaredEvents() {
  const events = stripComments(read(join(ROOT, 'contract', 'events.ts')))
  return [...new Set([...events.matchAll(/\btype:\s*'([^']+)'/g)].map((m) => m[1]))]
}

test('every ServerEvent the contract declares has a server producer and a client-router consumer', () => {
  const declared = declaredEvents()
  assert.ok(declared.length >= 15, `expected the full event union; parsed only ${declared.length}`)

  const server = concatSource('server')
  // Ambient events route through src/api/events.ts; reply-stream events through the
  // send dispatch in src/api/commands.ts. Together they must cover the whole union.
  const routers =
    stripComments(read(join(ROOT, 'src', 'api', 'events.ts'))) +
    '\n' +
    stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))

  const noProducer = declared.filter((t) => !server.includes(`'${t}'`))
  assert.deepEqual(noProducer, [], `declared events with NO server producer (dead/reserved wire surface): ${noProducer.join(', ')}`)

  const noConsumer = declared.filter((t) => !routers.includes(`case '${t}'`))
  assert.deepEqual(noConsumer, [], `declared events the client router never handles: ${noConsumer.join(', ')}`)
})

test('the client routers handle no event the ServerEvent contract does not declare (no stale handler)', () => {
  const declared = new Set(declaredEvents())
  const routers =
    stripComments(read(join(ROOT, 'src', 'api', 'events.ts'))) +
    '\n' +
    stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const handled = [...new Set([...routers.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]))]
  const undeclared = handled.filter((t) => !declared.has(t))
  assert.deepEqual(undeclared, [], `client router cases absent from the ServerEvent union: ${undeclared.join(', ')}`)
})

// ── The HTTP boundary: every declared request DTO is actually wired ──────────
test('authored formula consumers share one inert evaluator and preserve source-only search', () => {
  const consumers = ['src/components/StructuredArtifactEditor.tsx', 'src/components/StructuredArtifactView.tsx', 'contract/artifactSnapshot.ts', 'server/artifactXlsx.ts']
  const check = (source: string) => {
    assert.match(source, /import \{[^}]*calculateWorkbook[^}]*\} from '[^']*workbookCalculation\.ts'/)
    assert.match(source, /calculateWorkbook\(/)
  }
  for (const path of consumers) {
    const source = stripComments(read(join(ROOT, path)))
    check(source)
    assert.throws(() => check(source.replaceAll('calculateWorkbook', 'parallelCalculator')), assert.AssertionError)
  }
  for (const file of ['workbookCalculation.ts', 'workbookFormula.ts', 'workbookStructure.ts']) {
    const evaluator = stripComments(read(join(ROOT, 'contract', file)))
    assert.doesNotMatch(evaluator, /\b(?:eval|Function|fetch|XMLHttpRequest|WebSocket|Date|process|document|window)\b/)
  }
  const search = stripComments(read(join(ROOT, 'contract/artifactSearch.ts')))
  assert.match(search, /sheetCellSource\(/)
  assert.doesNotMatch(search, /calculate(?:Sheet|Workbook)/)
})

test('renderer and native local MCP review import and render one framework-free approval disclosure', () => {
  const consumers = ['src/components/McpConnectionPanel.tsx', 'src/components/McpStdioSetupDialog.tsx', 'desktop/main.mjs']
  const check = (path: string, source: string) => {
    assert.match(source, /import \{ MCP_STDIO_TOOL_APPROVAL_COPY \} from ['"].*contract\/mcpStdioSetupCopy\.mjs['"]/, path)
    assert.match(source, path.endsWith('.tsx') ? /\{MCP_STDIO_TOOL_APPROVAL_COPY\}/ : /\+ MCP_STDIO_TOOL_APPROVAL_COPY \+/, path)
    assert.doesNotMatch(source, /Routines and Contributions cannot use|not Routines or Contribution effects|not available to Routines or Contribution effects/, path)
  }
  for (const path of consumers) {
    const source = read(join(ROOT, path))
    check(path, source)
    const mutant = source.replaceAll('MCP_STDIO_TOOL_APPROVAL_COPY', 'obsoleteCopy')
    assert.notEqual(mutant, source)
    assert.throws(() => check(path, mutant), assert.AssertionError)
  }
})

test('every *Request DTO in the contract is referenced by a route or command (no dead wire types)', () => {
  const contractSrc = concatSource('contract')
  const names = [...new Set([...contractSrc.matchAll(/export interface (\w+Request)\b/g)].map((m) => m[1]))]
  assert.ok(names.length >= 10, `expected the request DTOs; parsed only ${names.length}`)

  const usage = concatSource('server') + '\n' + concatSource('src')
  const unused = names.filter((name) => !usage.includes(name))
  assert.deepEqual(unused, [], `request DTOs declared but used by neither end (drift from the inline body types): ${unused.join(', ')}`)
})
