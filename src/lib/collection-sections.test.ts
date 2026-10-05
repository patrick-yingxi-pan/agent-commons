import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  ACCOUNT_MCP_SECTION,
  CONTEXT_COLLECTION_SECTIONS,
  LOCAL_GIT_SECTION,
  PROVIDERS_SECTION,
  artifactCollectionSections,
  collectionSectionLabel,
  contextCollectionSections,
  localGitCollectionSection,
  modelCollectionSections,
} from './collectionSections.ts'
import { ROOT, read, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import type { ArtifactItem, ModelProvider, Project, SavedContext } from '../types.ts'

test('collection grouping is one pure projection shared by rail and page', () => {
  const tree = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  const contextRail = stripComments(read(join(ROOT, 'src', 'components', 'ContextChildren.tsx')))
  const artifactRail = stripComments(read(join(ROOT, 'src', 'components', 'ArtifactChildren.tsx')))
  const rail = `${tree}\n${contextRail}\n${artifactRail}`
  const contextDoor = stripComments(read(join(ROOT, 'src', 'components', 'DeferredContextChildren.tsx')))
  const artifactDoor = stripComments(read(join(ROOT, 'src', 'components', 'DeferredArtifactChildren.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  for (const fn of ['artifactCollectionSections', 'contextCollectionSections', 'modelCollectionSections']) {
    assert.ok(rail.includes(`${fn}(`), `rail calls ${fn}`)
    assert.ok(page.includes(`${fn}(`), `page calls ${fn}`)
  }
  assert.match(tree, /<CollectionSectionRows/)
  assert.match(tree, /structuralCollectionProjection\(/, 'the shared rail row template enters the runtime projection')
  assert.match(page, /structuralCollectionProjection\(/, 'page groups enter the shared runtime projection')
  assert.match(tree, /<RailCollectionTemplate/, 'the rail projection owns structural group rendering')
  assert.match(page, /<MainCollectionTemplate/, 'the page projection owns structural group rendering')
  assert.match(tree, /data-collection-section=\{group\.key\}/)
  assert.match(tree, /onOpenDetail\(section, \{ collectionSectionId: group\.key \}\)/)
  assert.match(tree, /data-collection-section-resources=\{group\.key\}/)
  assert.match(tree, /<DeferredContextChildren renderRows=\{CollectionSectionRows\}/)
  assert.match(tree, /<DeferredArtifactChildren renderRows=\{CollectionSectionRows\}/)
  assert.match(contextDoor, /lazy\([\s\S]*import\('\.\/ContextChildren\.tsx'\)/,
    'the actual context group body, not a concatenated decoy, is loaded at the door')
  assert.match(artifactDoor, /lazy\([\s\S]*import\('\.\/ArtifactChildren\.tsx'\)/,
    'the actual artifact group body is loaded at its door')
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
  assert.equal(collectionSectionLabel('contexts', LOCAL_GIT_SECTION.id), LOCAL_GIT_SECTION.label)
  assert.equal(collectionSectionLabel('models', PROVIDERS_SECTION.id), PROVIDERS_SECTION.label)
  assert.equal(collectionSectionLabel('artifacts', 'p1', { p1: 'Insights' }), 'Insights')
})

test('native Git repositories share one filtered and sorted page/rail projection', () => {
  const rows = [
    { id: `GIT_${'B'.repeat(32)}` as const, name: 'Zebra', remembered: false },
    { id: `GIT_${'A'.repeat(32)}` as const, name: 'alpha', remembered: true },
  ]
  assert.deepEqual(localGitCollectionSection(rows, { facet: 'all', sortBy: 'alpha' }).items.map(row => row.name), ['alpha', 'Zebra'])
  assert.deepEqual(localGitCollectionSection(rows, { facet: 'local-git', sortBy: 'alpha' }, 'zeb').items.map(row => row.id), [rows[0]!.id])
  assert.deepEqual(localGitCollectionSection(rows, { facet: 'repo', sortBy: 'alpha' }).items, [], 'other Contexts facets exclude native Git rows')
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
