import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SEARCH_HIT_TYPES, type SearchHitType, type SearchResponse } from '../../contract/search.ts'
import { searchHitDestination, searchResponseMatches } from './searchResults.ts'
import { locOfSeed, seedFor } from './paneNav.ts'
import { pathForView } from './urlRoutes.ts'

test('every search hit preserves its exact resource identity through the canonical navigation bridge', () => {
  const paths: Record<SearchHitType, string> = {
    session: '/s/id%2Fone', project: '/projects/id%2Fone', sharedProject: '/projects/id%2Fone',
    artifact: '/artifacts/id%2Fone', schedule: '/scheduled/id%2Fone',
    agent: '/agents/id%2Fone', publishedAgent: '/agents/id%2Fone', prompt: '/agents/prompts/id%2Fone',
    model: '/models/id%2Fone', context: '/contexts/id%2Fone', owner: '/u/id%2Fone',
    openWork: '/projects/parent%2Ftwo/work/id%2Fone',
  }
  assert.deepEqual(Object.keys(paths).sort(), [...SEARCH_HIT_TYPES].sort(), 'enumerate the real contract, not a hand-picked subset')
  for (const type of SEARCH_HIT_TYPES) {
    const destination = searchHitDestination({ type, id: 'id/one', title: 'Name is not identity', subtitle: '', ref: 'parent/two' })!
    assert.ok(destination, type)
    const path = destination.kind === 'session'
      ? pathForView({ kind: 'session', sessionId: destination.id, title: '' }, null)
      : pathForView({ kind: 'section', section: destination.section, ...locOfSeed(seedFor(destination.section, destination.id, destination.subId)!) }, null)
    assert.equal(path, paths[type], type)
  }
  assert.equal(searchHitDestination({ type: 'openWork', id: 'unknown', title: '', subtitle: '' }), undefined, 'missing parent must not guess a collection destination')
})

test('search response matching pins normalized query, category and exact page offset', () => {
  const overview: SearchResponse = { query: 'needle', groups: [] }
  const page: SearchResponse = { ...overview, page: { type: 'artifact', offset: 20 } }
  assert.equal(searchResponseMatches(overview, ' NEEDLE '), true)
  assert.equal(searchResponseMatches(page, 'needle', { type: 'artifact', offset: 20 }), true)
  assert.equal(searchResponseMatches(undefined, 'needle'), false)
  assert.equal(searchResponseMatches(overview, 'changed'), false)
  assert.equal(searchResponseMatches(overview, 'needle', page.page), false)
  assert.equal(searchResponseMatches(page, 'needle'), false)
  assert.equal(searchResponseMatches(page, 'needle', { type: 'context', offset: 20 }), false)
  assert.equal(searchResponseMatches(page, 'needle', { type: 'artifact', offset: 0 }), false)
})

test('the palette binds exact destinations and current response matching to its rendered result rows', () => {
  const panel = readFileSync(new URL('../components/SearchPanel.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  assert.match(panel, /searchHitDestination\(h\)/)
  assert.match(panel, /onOpenSection\(destination.section, destination.id, destination.subId\)/)
  assert.match(panel, /searchResponseMatches\(server.data, needle, page\)/)
  assert.match(panel, /settled \? server.data\?\.groups/)
  assert.match(panel, /data-search-result=\{r.key\}/)
  assert.match(panel, /searchResultSubtitleClass\(isActive\)/)
  assert.match(panel, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  const search = app.slice(app.indexOf('<DeferredSearchPanel'), app.indexOf('/>', app.indexOf('<DeferredSearchPanel')))
  assert.match(search, /onOpenSection=\{navigateToSection\}/, 'the shell must not drop the result id')
})
