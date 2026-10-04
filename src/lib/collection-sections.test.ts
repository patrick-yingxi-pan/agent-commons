import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  ACCOUNT_MCP_SECTION,
  CONTEXT_COLLECTION_SECTIONS,
  PROVIDERS_SECTION,
  artifactCollectionSections,
  collectionSectionLabel,
  contextCollectionSections,
  modelCollectionSections,
} from './collectionSections.ts'
import { ROOT, read, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import type { ArtifactItem, ModelProvider, Project, SavedContext } from '../types.ts'

test('collection grouping is one pure projection shared by rail and page', () => {
  const rail = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  for (const fn of ['artifactCollectionSections', 'contextCollectionSections', 'modelCollectionSections']) {
    assert.ok(rail.includes(`${fn}(`), `rail calls ${fn}`)
    assert.ok(page.includes(`${fn}(`), `page calls ${fn}`)
  }
  assert.match(rail, /<CollectionSectionRows/)
  assert.match(rail, /structuralCollectionProjection\(/, 'rail groups enter the shared runtime projection')
  assert.match(page, /structuralCollectionProjection\(/, 'page groups enter the shared runtime projection')
  assert.match(rail, /<RailCollectionTemplate/, 'the rail projection owns structural group rendering')
  assert.match(page, /<MainCollectionTemplate/, 'the page projection owns structural group rendering')
  assert.match(rail, /data-collection-section=\{group\.key\}/)
  assert.match(rail, /onOpenDetail\(section, \{ collectionSectionId: group\.key \}\)/)
  assert.match(rail, /data-collection-section-resources=\{group\.key\}/)
})

test('Artifacts groups by live project membership with an honest Unfiled tail', () => {
  const projects = [{ id: 'p1', name: 'Insights' }, { id: 'p2', name: 'Hardening' }] as Project[]
  const artifacts = [
    { id: 'a1', name: 'One' },
    { id: 'a2', name: 'Two' },
    { id: 'a3', name: 'Three' },
  ] as ArtifactItem[]
  const membership: Record<string, string | undefined> = { a1: 'p1', a2: 'p2', a3: undefined }
  assert.deepEqual(
    artifactCollectionSections(artifacts, projects, (artifact) => membership[artifact.id]).map((group) => [group.id, group.label, group.items.map((item) => item.id)]),
    [
      ['p1', 'Insights', ['a1']],
      ['p2', 'Hardening', ['a2']],
      ['__unfiled', 'Unfiled', ['a3']],
      ['__trash', 'Trash', []],
    ],
  )
})

test('Contexts and Models keep their main-page section skeleton in the rail', () => {
  const contexts = [
    { id: 'c1', kind: 'connector' },
    { id: 'c2', kind: 'mcp' },
    { id: 'c3', kind: 'repo' },
  ] as SavedContext[]
  assert.deepEqual(contextCollectionSections(contexts).map((group) => group.label), CONTEXT_COLLECTION_SECTIONS.map((section) => section.label))
  assert.deepEqual(contextCollectionSections(contexts).map((group) => group.items.length), [1, 1, 1])
  const providers = [{ id: 'anthropic' }, { id: 'openai' }] as ModelProvider[]
  assert.deepEqual(modelCollectionSections(providers), [{ ...PROVIDERS_SECTION, items: providers }])
  assert.equal(collectionSectionLabel('contexts', ACCOUNT_MCP_SECTION.id), ACCOUNT_MCP_SECTION.label)
  assert.equal(collectionSectionLabel('models', PROVIDERS_SECTION.id), PROVIDERS_SECTION.label)
  assert.equal(collectionSectionLabel('artifacts', 'p1', { p1: 'Insights' }), 'Insights')
})

test('each selected collection section becomes the sole forced-open main-page projection', () => {
  for (const name of ['ArtifactsSection', 'ContextsSection', 'ModelsSection']) {
    const page = stripComments(sectionViewComponent(name))
    assert.match(page, /<CompositeResourcePage section="[^"]+" sectionPage=/, `${name} declares section-page mode`)
    assert.match(page, /collectionSectionId/, `${name} reads the canonical intermediate page id`)
  }
  const page = stripComments(read(join(ROOT, 'src', 'components', 'ResourcePage.tsx')))
  assert.match(page, /const effectiveFolded = sectionPage \|\| heldOpen \? false : folded/,
    'selected section pages remain one of the shared primitive’s forced-open states')
})
