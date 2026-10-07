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

// ── The built UI survives a canonical deep link ─────────────────────────────
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
test('every *Request DTO in the contract is referenced by a route or command (no dead wire types)', () => {
  const contractSrc = concatSource('contract')
  const names = [...new Set([...contractSrc.matchAll(/export interface (\w+Request)\b/g)].map((m) => m[1]))]
  assert.ok(names.length >= 10, `expected the request DTOs; parsed only ${names.length}`)

  const usage = concatSource('server') + '\n' + concatSource('src')
  const unused = names.filter((name) => !usage.includes(name))
  assert.deepEqual(unused, [], `request DTOs declared but used by neither end (drift from the inline body types): ${unused.join(', ')}`)
})
