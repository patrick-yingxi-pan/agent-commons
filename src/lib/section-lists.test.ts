/** The ordered list behind BOTH projections of a content section — the rail
 *  tree's instance children and the section page (src/lib/sectionLists.ts,
 *  UI-19). The rail shows the head of what the page shows, so these lock the
 *  facet classification and the order itself: a rail listing a *different* top
 *  eight than the page would be worse than a rail listing none. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  discussionActivityAt,
  groupProjects,
  listArtifacts,
  listContexts,
  listDiscussions,
  listProjects,
  listProviders,
  projectFacet,
  providerFacet,
} from './sectionLists.ts'
import { ALL_FACET, sortSectionRows } from './sectionFilter.ts'

const F = (facet, sortBy) => ({ facet, sortBy })

const project = (id, over = {}) => ({ id, name: id, description: '', updatedAt: 0, ...over })

test('a project falls in exactly one band: yours, an org seat, or shared with you', () => {
  const orgs = new Set(['t-acme'])
  assert.equal(projectFacet(project('a'), orgs), 'mine')
  assert.equal(projectFacet(project('b', { tenantId: 't-acme' }), orgs), 'org')
  // An org seat wins over `own` either way — it is a seat, not ownership (FWD-6).
  assert.equal(projectFacet(project('c', { tenantId: 't-acme', own: false }), orgs), 'org')
  assert.equal(projectFacet(project('d', { own: false }), orgs), 'shared')
  // A foreign tenant you have no seat in is someone else's share, not an org row.
  assert.equal(projectFacet(project('e', { tenantId: 't-other', own: false }), orgs), 'shared')
})

test('the projects list: facet narrows, sort orders, and neither mutates the source', () => {
  const orgs = new Set(['t-acme'])
  const rows = [
    project('p-b', { name: 'Beta', updatedAt: 30 }),
    project('p-a', { name: 'Alpha', updatedAt: 10 }),
    project('p-o', { name: 'Org', updatedAt: 20, tenantId: 't-acme' }),
    project('p-s', { name: 'Shared', updatedAt: 40, own: false }),
  ]
  const frozen = [...rows]
  // BAND-major, sort-minor: yours, then your orgs, then the commons — the order
  // the page draws, so the rail's head is the page's first rows. (Purely by
  // recency, `p-s` would lead and your own two would sink below every share.)
  assert.deepEqual(
    listProjects(rows, F(ALL_FACET, 'recency'), orgs).map((p) => p.id),
    ['p-b', 'p-a', 'p-o', 'p-s'],
  )
  assert.deepEqual(
    listProjects(rows, F(ALL_FACET, 'alpha'), orgs).map((p) => p.id),
    ['p-a', 'p-b', 'p-o', 'p-s'],
  )
  assert.deepEqual(listProjects(rows, F('org', 'recency'), orgs).map((p) => p.id), ['p-o'])
  assert.deepEqual(listProjects(rows, F('shared', 'recency'), orgs).map((p) => p.id), ['p-s'])
  assert.deepEqual(listProjects(rows, F('mine', 'recency'), orgs).map((p) => p.id), ['p-b', 'p-a'])
  assert.deepEqual(rows, frozen, 'the shared registry read is never sorted in place')
  assert.deepEqual(
    groupProjects(listProjects(rows, F(ALL_FACET, 'recency'), orgs), orgs).map((group) => ({
      key: group.key,
      label: group.label,
      projects: group.projects.map((entry) => entry.id),
    })),
    [
      { key: 'mine', label: 'Yours', projects: ['p-b', 'p-a'] },
      { key: 'org', label: 'Your organizations', projects: ['p-o'] },
      { key: 'shared', label: 'Shared with you', projects: ['p-s'] },
    ],
    'the page and rail receive the same named relationship lists',
  )
})

test('artifacts and contexts narrow on their own kind', () => {
  const arts = [
    { id: 'a1', name: 'Deck', kind: 'slide', editedAt: 5 },
    { id: 'a2', name: 'Brief', kind: 'doc', editedAt: 9 },
    { id: 'a3', name: 'Chart', kind: 'sheet', editedAt: 1 },
  ]
  assert.deepEqual(listArtifacts(arts, F(ALL_FACET, 'recency')).map((a) => a.id), ['a2', 'a1', 'a3'])
  assert.deepEqual(listArtifacts(arts, F('doc', 'recency')).map((a) => a.id), ['a2'])
  assert.deepEqual(listArtifacts(arts, F(ALL_FACET, 'alpha')).map((a) => a.id), ['a2', 'a3', 'a1'])

  const ctxs = [
    { id: 'c1', label: 'GitHub', kind: 'connector', lastUsedAt: 7 },
    { id: 'c2', label: 'Repo', kind: 'repo', lastUsedAt: null },
    { id: 'c3', label: 'Server', kind: 'mcp', lastUsedAt: 3 },
  ]
  assert.deepEqual(listContexts(ctxs, F(ALL_FACET, 'recency')).map((c) => c.id), ['c1', 'c3', 'c2'])
  assert.deepEqual(listContexts(ctxs, F('repo', 'recency')).map((c) => c.id), ['c2'])
})

test('a provider’s facet is its origin — built-in, registered, or a delegated session', () => {
  assert.equal(providerFacet({ id: 'p1', label: 'Anthropic' }), 'builtin')
  assert.equal(providerFacet({ id: 'p2', label: 'Mine', tenantId: 't1' }), 'registered')
  // A session provider is always tenant-stamped, so `session` must win over
  // `registered` or its rows would land in the wrong band.
  assert.equal(providerFacet({ id: 'p3', label: 'Relay', tenantId: 't1', kind: 'session' }), 'session')
  const rows = [
    { id: 'p2', label: 'Zulu', tenantId: 't1' },
    { id: 'p1', label: 'Anthropic' },
    { id: 'p3', label: 'Relay', tenantId: 't1', kind: 'session' },
  ]
  assert.deepEqual(listProviders(rows, F(ALL_FACET, 'alpha')).map((p) => p.id), ['p1', 'p3', 'p2'])
  assert.deepEqual(listProviders(rows, F('session', 'alpha')).map((p) => p.id), ['p3'])
})

test('threads order by LAST activity, and open ones lead the all view', () => {
  const d = (id, state, openedAt, postAt) => ({
    id,
    state,
    openedAt,
    posts: postAt === undefined ? [] : [{ id: `${id}-1`, body: `${id} body`, at: postAt }],
  })
  // A thread with one post is as recent as that post, not as its opening.
  assert.equal(discussionActivityAt(d('x', 'open', 1, 99)), 99)
  assert.equal(discussionActivityAt(d('y', 'open', 7)), 7)
  const rows = [d('r1', 'resolved', 1, 100), d('o1', 'open', 2, 50), d('o2', 'open', 3, 10)]
  assert.deepEqual(
    listDiscussions(rows, F(ALL_FACET, 'recency')).map((x) => x.id),
    ['o1', 'o2', 'r1'],
    'open first — the hub’s standing read is what still needs you',
  )
  // Inside one state the band is a no-op, so the chosen sort survives intact.
  assert.deepEqual(listDiscussions(rows, F('open', 'recency')).map((x) => x.id), ['o1', 'o2'])
  assert.deepEqual(listDiscussions(rows, F('resolved', 'recency')).map((x) => x.id), ['r1'])
})

test('the shared comparator: alpha, newest, oldest — ties broken by name, never by luck', () => {
  const rows = [
    { n: 'b', t: 2 },
    { n: 'a', t: 2 },
    { n: 'c', t: 9 },
  ]
  const face = { name: (r) => r.n, at: (r) => r.t }
  assert.deepEqual(sortSectionRows(rows, 'alpha', face).map((r) => r.n), ['a', 'b', 'c'])
  assert.deepEqual(sortSectionRows(rows, 'recency', face).map((r) => r.n), ['c', 'a', 'b'])
  assert.deepEqual(sortSectionRows(rows, 'oldest', face).map((r) => r.n), ['a', 'b', 'c'])
  // An unknown sort id falls back to the recency order rather than throwing —
  // the clamp already fixes the stored value; this is the belt.
  assert.deepEqual(sortSectionRows(rows, 'whatever', face).map((r) => r.n), ['c', 'a', 'b'])
})
