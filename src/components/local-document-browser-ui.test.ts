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
    assert.ok(binding.includes(`return prepareLocalFilePreview(await api.readLocal${name}File(id, path), signal)`))
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
  assert.ok(!/uiHostFs|importWorkbook|importPresentation|Ocr|fetch\(|localStorage/.test(projection), 'selected text preview cannot acquire upload, structured authoring, OCR or network authority')
})

test('shared document preview discloses format fidelity and distinct source/text bounds before exact saved-copy attachment', () => {
  const view = source('src/components/LocalFileBrowserView.tsx')
  assert.ok(view.includes('data-local-document-preview={state.preview.documentImport.format}'))
  assert.ok(view.includes('documentImportCopy(state.preview.documentImport)'))
  assert.ok(view.includes('source bytes · extracted-text limit 65,536 bytes. Original document bytes are not saved.'))
  assert.ok(view.includes('await localFileSavedCopy.submit({'), 'explicit saved-copy intent centralizes upload and publication')
  assert.ok(view.includes('previewText === null'), 'omitted/no-text document results cannot attach')
  assert.ok(view.indexOf('documentImportCopy(state.preview.documentImport)') < view.indexOf('onClick={() => void attachSavedCopy()}'))
  for (const kind of ['Folder', 'Git']) {
    const picker = source(`src/components/Local${kind}Connections.tsx`)
    const wrapper = source(`src/components/Local${kind}Browser.tsx`)
    assert.ok(picker.includes("...(file.kind === 'file' ? { previewText: file.text } : { image: file.image })"), 'only the prepared text or durable image reference joins ordinary context')
    assert.ok(picker.includes('...(file.documentImport && { documentImport: file.documentImport })'), 'document fidelity accompanies prepared text')
    assert.ok(wrapper.includes('PDF, DOCX, XLSX and PPTX sources up to 8 MiB with extracted text up to 64 KiB'))
    assert.ok(wrapper.includes('without OCR or formula calculation'))
    assert.ok(wrapper.includes('cancels selected document or image processing') || wrapper.includes('cancels document extraction or image processing'))
    assert.ok(wrapper.includes('PNG, JPEG, GIF, WebP, BMP, ICO and self-contained static SVG images up to 8 MiB'))
    assert.ok(wrapper.includes('first frame or largest ICO image'))
    assert.ok(!/snapshot\.document|document\.bytes/.test(picker + wrapper))
  }
})
