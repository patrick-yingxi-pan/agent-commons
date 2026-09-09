/** UI-29 — an addressable resource is a page, never a modal over the page it
 * replaces. The DOM half lives in social-sharing.spec.ts; this source lock
 * guards the structural seam that made `/artifacts/:id` look like a popup. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

test('an artifact detail replaces the index with a standard main page', () => {
  const section = stripComments(sectionViewComponent('ArtifactsSection')).replace(/\s+/g, ' ')
  assert.ok(
    section.includes('if (openArtifact) {') &&
      section.includes('return ( <AtomicResourcePage> <ArtifactDetailPage'),
    'the routed artifact must return through AtomicResourcePage instead of layering over the index',
  )
  assert.doesNotMatch(section, /<ArtifactViewer\b/, 'the index no longer mounts an overlay viewer')
})

test('the artifact surface carries page grammar and no modal grammar', () => {
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  assert.match(page, /export function ArtifactDetailPage\(/)
  assert.match(page, /data-artifact-page=\{artifact\.id\}/, 'the DOM exposes the canonical page for browser verification')
  assert.match(page, /<header className=\{PAGE_HEADER_CLASS\}>/)
  assert.match(page, /<BackButton\b/)
  assert.match(page, /Section: MainPageSectionComponent/, 'the page requires the shared FoldSection grammar')
  assert.match(page, /title="Content"/)
  assert.match(page, /title="Sharing"/)
  assert.match(page, /title="Provenance"/)
  assert.doesNotMatch(page, /aria-modal="true"|role="dialog"|fixed inset-0|SCRIM_CLASS|DIALOG_SURFACE_CLASS/)
  assert.doesNotMatch(page, /useFocusTrap/, 'a main page must not trap keyboard focus like a popup')
})

test('direct creation opens the real authored Artifact workflow and its canonical page', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(section, />\s*New artifact\s*</, 'the action names the document/sheet/deck capability it opens')
  assert.match(section, /<NewArtifactDialog/, 'creation has one dedicated authored form')
  assert.match(section, /onCreated=\{\(id\) => \{[\s\S]*rel\.navigate\('artifacts', id\)/,
    'acknowledged creation opens the exact server-owned identity through canonical pane navigation')
  assert.doesNotMatch(section, /setCreatedDocumentName|applyOp\(\{[\s\S]*kind: 'save-artifact'/,
    'direct creation no longer borrows name/source relation replay semantics')
})

test('every addressed artifact body consumer refuses display-name fallback', () => {
  const preview = stripComments(read(join(ROOT, 'src/components/artifactPreview.tsx')))
  assert.match(preview, /const lib = artifactId \? library\?\.\[artifactId\] : library\?\.\[name\]/)
  const proposals = stripComments(read(join(ROOT, 'src/components/ProposalsPanel.tsx')))
  assert.match(proposals, /const body = isArtifact \? lib\?\.\[subject\.id\] : undefined/)
  const commands = stripComments(read(join(ROOT, 'src/api/commands.ts')))
  const resolver = commands.slice(commands.indexOf('function cachedArtifactBody('), commands.indexOf('export const peekArtifactContent'))
  assert.match(resolver, /return library\?\.\[artifactId\]/)
  assert.doesNotMatch(resolver, /\.name|cachedArtifactRows\(/)
})
