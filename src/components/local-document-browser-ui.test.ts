import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, relative } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (path: string) => stripComments(read(join(ROOT, path)))
const importPath = (owner: string, target: string) => {
  const path = relative(dirname(join(ROOT, owner)), join(ROOT, target)).split('\\').join('/')
  return path.startsWith('.') ? path : `./${path}`
}

test('both local source bindings normalize document bytes before browser state and pass cancellation', () => {
  for (const [name, api] of [['Folder', 'Folders'], ['Git', 'Git']]) {
    const binding = source(`src/controller/local${name}Browser.ts`)
    const core = source(`src/controller/local${name}BrowserCore.ts`)
    assert.ok(binding.includes("import { prepareLocalFilePreview } from '../lib/localFilePreview.ts'"))
    assert.ok(binding.includes('preview: async (id, path, signal) => {'))
    assert.ok(binding.includes('signal.throwIfAborted()'))
    assert.ok(binding.includes(`return prepareLocalFilePreview(await api.readLocal${name}File(id, path), signal, undefined, undefined, { retainPdfOcrInput: desktopPdfOcrAvailable() })`))
    assert.ok(binding.includes("import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'"))
    assert.ok(binding.includes('processPreview: recognizeLocalPdfPreview'))
    assert.ok(binding.includes(`local${name}Connections.subscribeDisconnect(id => local${name}Browser.dismiss(id))`))
    assert.ok(binding.includes(`onAccountSwitch(() => local${name}Browser.clear())`))
    assert.ok(core.includes(`export type Local${name}BrowsePreview = LocalBrowsePreview`), 'raw native preview is not a controller state type')
    assert.ok(!core.includes(`Local${name}FilePreview`))
    const commandsPath = importPath(`src/controller/local${name}Browser.ts`, `src/api/local${api}.ts`)
    assert.ok(binding.includes(`import('${commandsPath}')`))
  }
  const projection = source('src/lib/localFilePreview.ts')
  const readerPath = importPath('src/lib/localFilePreview.ts', 'src/lib/documentFileImport.ts')
  assert.ok(projection.includes(`await import('${readerPath}')`), 'reader graph remains lazy until selected document intake')
  assert.ok(!/^import .* from ['"]\.\/documentFileImport/m.test(projection), 'no eager worker-importer graph')
  assert.ok(!/uiHostFs|importWorkbook|importPresentation|fetch\(|localStorage/.test(projection), 'selected text preview cannot acquire upload, structured authoring or network authority')
})

test('shared document preview discloses format fidelity and distinct source/text bounds before exact saved-copy attachment', () => {
  const view = source('src/components/LocalFileBrowserView.tsx')
  const savedCopyAction = source('src/components/LocalSavedCopyAction.tsx')
  assert.ok(view.includes('data-local-document-preview={state.preview.documentImport.format}'))
  assert.ok(view.includes('documentImportCopy(state.preview.documentImport)'))
  assert.ok(view.includes('source bytes · extracted-text limit 65,536 bytes. Original document bytes are not saved.'))
  assert.ok(view.includes('<LocalSavedCopyAction'), 'document previews reuse the saved-copy action')
  assert.ok(savedCopyAction.includes('localFileSavedCopy.submit({'), 'explicit saved-copy intent centralizes upload and publication')
  assert.ok(view.includes('previewText !== null'), 'only an actual extracted-text preview reaches the action')
  assert.ok(savedCopyAction.includes("typeof preview.snapshot.text === 'string'"), 'omitted/no-text document results cannot attach')
  assert.ok(view.indexOf('documentImportCopy(state.preview.documentImport)') < view.indexOf('<LocalSavedCopyAction'), 'source fidelity disclosure precedes the shared action')
  for (const kind of ['Folder', 'Git']) {
    const picker = source(`src/components/Local${kind}Connections.tsx`)
    const wrapper = source(`src/components/Local${kind}Browser.tsx`)
    assert.ok(picker.includes("...(file.kind === 'file' ? { previewText: file.text } : { image: file.image })"), 'only the prepared text or durable image reference joins ordinary context')
    assert.ok(picker.includes('...(file.documentImport && { documentImport: file.documentImport })'), 'document fidelity accompanies prepared text')
    assert.ok(wrapper.includes('PDF, DOCX, XLSX and PPTX sources up to 8 MiB with extracted text up to 64 KiB'))
    assert.ok(wrapper.includes('Default PDF preview extracts embedded text only; selected PDFs can use separate explicit on-device OCR.'))
    assert.ok(wrapper.includes('Other document extraction is text-only, without formula calculation.'))
    assert.ok(wrapper.includes('cancels selected document or image processing') || wrapper.includes('cancels document extraction or image processing'))
    assert.ok(wrapper.includes('PNG, JPEG, GIF, WebP, BMP, ICO and self-contained static SVG images up to 8 MiB'))
    assert.ok(wrapper.includes('first frame or largest ICO image'))
    assert.ok(!/snapshot\.document|document\.bytes/.test(picker + wrapper))
  }
})

test('selected PDF OCR is capability-gated, cancellable, and fences saved-copy attachment while pending', () => {
  const folder = source('src/components/LocalFolderBrowser.tsx')
  const git = source('src/components/LocalGitBrowser.tsx')
  const view = source('src/components/LocalFileBrowserView.tsx')
  for (const [binding, module] of [
    ['src/controller/localFolderBrowser.ts', 'localFolderBrowser'],
    ['src/controller/localGitBrowser.ts', 'localGitBrowser'],
    ['src/controller/localGitUntrackedBrowser.ts', 'localGitUntrackedBrowser'],
  ]) {
    const controller = source(binding)
    assert.ok(controller.includes("import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'"))
    assert.ok(controller.includes('retainPdfOcrInput: desktopPdfOcrAvailable()'), 'raw bytes are retained only where the native OCR bridge exists')
    assert.ok(controller.includes('processPreview: recognizeLocalPdfPreview'), 'recognition receives the selected detached preview')
    const wrapper = module === 'localFolderBrowser' ? folder : git
    assert.ok(wrapper.includes(`processPreview={receipt => ${module}.processPreview(id, receipt)}`))
    assert.ok(wrapper.includes(`cancelProcessing={() => ${module}.cancelProcessing(id)}`))
    assert.ok(wrapper.includes('pdfOcrAvailable={desktopPdfOcrAvailable()}'))
    assert.ok(wrapper.includes(`!${module}.get(id).pending`), 'saved-copy receipt is not current while OCR is pending')
  }
  assert.ok(view.includes('const canRecognizePdf = Boolean(state.preview?.pdfOcrInput && pdfOcrAvailable && processPreview && cancelProcessing)'))
  assert.ok(view.includes('Recognize scanned text'))
  assert.ok(view.includes('Cancel recognition'))
  assert.ok(view.includes('Recognizing PDF text…'))
  assert.ok(view.includes('state.processingError ??'))
  assert.ok(view.includes('On supported macOS desktop, OCR uses the already-read PDF bytes.'))
  assert.ok(view.includes('Recognition replaces the preview with text for review; it does not save, upload, or send anything. Attach is separate.'))
  assert.ok(view.includes('No embedded PDF text was found. Recognize scanned text on this Mac, then review it below.'))
})

test('embedded PDF text collection stays outside eager shared PDF policy', () => {
  const policy = source('contract/pdfImport.mjs')
  const collection = source('contract/pdfTextCollection.mjs')
  const extractor = source('src/lib/pdfExtractor.ts')
  const projection = source('src/lib/localFilePreview.ts')
  const assertPolicyExcludesCollector = (text: string) => assert.doesNotMatch(text, /collectPdfText/)
  assertPolicyExcludesCollector(policy)
  assert.match(collection, /export async function collectPdfText\(/)
  assert.match(collection, /from ['"]\.\/pdfImport\.mjs['"]/, 'the collector reuses shared PDF bounds and outcomes')
  assert.match(extractor, /from ['"]\.\.\/\.\.\/contract\/pdfTextCollection\.mjs['"]/, 'the selected worker path owns text collection')
  const readerPath = importPath('src/lib/localFilePreview.ts', 'src/lib/documentFileImport.ts')
  assert.ok(projection.includes(`await import('${readerPath}')`), 'the collector remains behind the selected-document reader import')
  assert.throws(() => assertPolicyExcludesCollector(`${policy}\nexport async function collectPdfText() {}`), /expected to not match/)
})
