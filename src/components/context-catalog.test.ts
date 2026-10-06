import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every context browse surface reads the server catalog without bundled fixture fallback', () => {
  for (const file of ['ContextPickerWorkflow.tsx', 'RepoContextPicker.tsx', 'SectionView.tsx']) {
    const source = stripComments(read(join(ROOT, 'src/components', file)))
    assert.match(source, /useContextCatalog\(/, `${file} must use the authoritative catalog`)
    assert.doesNotMatch(source, /(?:CONNECTOR_OPTIONS|MCP_OPTIONS|LOCAL_REPO_OPTIONS|GITHUB_REPO_OPTIONS|SAVED_CONTEXTS)/, `${file} cannot offer bundled demo entities`)
    assert.match(source, /<ContextCatalogNotice/, `${file} must disclose read state and demo data`)
  }
})

test('demo disclosure stays inside optional browsers and repository confirmation', () => {
  const browse = stripComments(read(join(ROOT, 'src/components/ContextBrowseDialog.tsx')))
  const repo = stripComments(read(join(ROOT, 'src/components/RepoContextPicker.tsx')))
  const picker = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  assert.match(browse, /developmentFixtures && <ContextDemoNotice/)
  assert.match(browse, /return createPortal\([\s\S]*document\.body/,
    'the browser cannot inherit a shifted popover containing block')
  assert.match(repo, /<BrowseDialog[\s\S]*developmentFixtures=\{catalog\.data\?\.developmentFixtures\}/)
  assert.match(picker, /<BrowseDialog[\s\S]*developmentFixtures=\{developmentFixtures\}/)
  assert.match(repo, /Sample data only; no code is pushed and no PR is opened/)
  assert.doesNotMatch(repo, /so Claude can push and open PRs/)
})
