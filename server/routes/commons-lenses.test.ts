/** ── The Commons lenses (S4) — watched · liked · posted · recently viewed ────
 *  The rail's Commons children are the VIEWER's standing collections, not a
 *  slice of the feed's content (UI-19: a rail child is a place; a partition is
 *  a filter). Every one of them is a server-stamped, viewer-relative field on
 *  `CommonsItem` — the `mine` pattern — so the client filters on what the
 *  server computed and never guesses what a reader watches or liked.
 *
 *  These lock the four signals end to end: the acts that fill them, the walls
 *  they inherit, and the registry↔UI pairing (a lens with no predicate would
 *  silently show the whole feed, which reads as "you watch everything"). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { COMMONS_LENSES } from '../../src/lib/subviews.ts'

const OWNER = 'tenant-lens-owner'
const READER = 'tenant-beta'
const STRANGER = 'tenant-lens-stranger'
let n = 0

/** A published share the READER can see — the fixture every lens needs. */
async function publishedProject(): Promise<{ projectId: string; itemId: string }> {
  const projectId = `p-lens-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Lens ${n}`, projectDescription: 'A lens world.' }, OWNER)
  await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: READER }, tier: 'propose', note: 'Look at this.' },
    { 'x-tenant-id': OWNER },
  )
  const feed = await call('GET', '/commons', undefined, { 'x-tenant-id': READER })
  const item = feed.json.find((i: any) => i.subject.id === projectId)
  assert.ok(item, 'the fixture published')
  return { projectId, itemId: item.id }
}

test('posted: the actor sees their own act as theirs, and nobody else does', async () => {
  const { projectId } = await publishedProject()
  const mine = (await call('GET', '/commons', undefined, { 'x-tenant-id': OWNER })).json.find((i: any) => i.subject.id === projectId)
  const theirs = (await call('GET', '/commons', undefined, { 'x-tenant-id': READER })).json.find((i: any) => i.subject.id === projectId)
  assert.equal(mine.mine, true, 'the sharer posted it')
  assert.equal(theirs.mine, undefined, 'absence is the negative (INV-9) — never `mine: false`')
  // The raw acting tenant never crosses the wire; only the boolean it decided.
  assert.ok(!('actorTenant' in theirs), 'the REDACTED face carries no raw tenant id')
})

test('liked: an explicit toggle, a public count, a viewer-relative flag', async () => {
  const { projectId, itemId } = await publishedProject()
  const read1 = async (tenant: string) =>
    (await call('GET', '/commons', undefined, { 'x-tenant-id': tenant })).json.find((i: any) => i.subject.id === projectId)

  assert.equal((await read1(READER)).likes, 0)
  assert.equal((await read1(READER)).liked, undefined)

  const on = await call('POST', `/commons/${encodeURIComponent(itemId)}/like`, { liked: true }, { 'x-tenant-id': READER })
  assert.equal(on.status, 200)
  assert.deepEqual(on.json, { likes: 1, liked: true })
  assert.equal((await read1(READER)).liked, true)
  // The COUNT is public (like a post's reactions); who liked it is not.
  const asOwner = await read1(OWNER)
  assert.equal(asOwner.likes, 1)
  assert.equal(asOwner.liked, undefined, 'the owner did not like it — the flag is per viewer')

  // Explicit, not a parity toggle: liking twice is idempotent, so two clients
  // pressing at once converge on what the user asked for.
  await call('POST', `/commons/${encodeURIComponent(itemId)}/like`, { liked: true }, { 'x-tenant-id': READER })
  assert.equal((await read1(READER)).likes, 1)
  const off = await call('POST', `/commons/${encodeURIComponent(itemId)}/like`, { liked: false }, { 'x-tenant-id': READER })
  assert.deepEqual(off.json, { likes: 0, liked: false })
})

test('a like inherits its subject’s wall — existence-hiding, like every social read', async () => {
  const { itemId } = await publishedProject()
  const denied = await call('POST', `/commons/${encodeURIComponent(itemId)}/like`, { liked: true }, { 'x-tenant-id': STRANGER })
  assert.equal(denied.status, 404, 'a subject you cannot see has no likeable post')
  const bogus = await call('POST', '/commons/share:nope/like', { liked: true }, { 'x-tenant-id': READER })
  assert.equal(bogus.status, 404)
  const bad = await call('POST', `/commons/${encodeURIComponent(itemId)}/like`, { liked: 'yes' }, { 'x-tenant-id': READER })
  assert.equal(bad.status, 400, 'liked must be a boolean (INV-9 strict core)')
})

test('watched: the key generalized past projects, and the project route is the same store', async () => {
  const { projectId } = await publishedProject()
  const feedWatched = async () =>
    (await call('GET', '/commons', undefined, { 'x-tenant-id': READER })).json.find((i: any) => i.subject.id === projectId)?.watched

  assert.equal(await feedWatched(), undefined)
  const on = await call('POST', '/social/watch', { subject: { kind: 'project', id: projectId }, watching: true }, { 'x-tenant-id': READER })
  assert.deepEqual(on.json, { watching: true })
  assert.equal(await feedWatched(), true)
  // The D24 project route reads the SAME subscription — one store, two doors.
  const viaProject = await call('GET', `/projects/${projectId}/watch`, undefined, { 'x-tenant-id': READER })
  assert.deepEqual(viaProject.json, { watching: true })
  await call('POST', `/projects/${projectId}/watch`, { watching: false }, { 'x-tenant-id': READER })
  assert.equal(await feedWatched(), undefined, 'unwatching through either door clears it in both')

  // A NON-project subject can now be watched at all — the half-feature this fixed.
  const d = await call('POST', '/discussions', { anchor: { ref: { kind: 'project', id: projectId } }, firstPost: 'Talk.' }, { 'x-tenant-id': READER })
  const disc = { kind: 'discussion', id: d.json.id }
  assert.deepEqual((await call('POST', '/social/watch', { subject: disc, watching: true }, { 'x-tenant-id': READER })).json, { watching: true })
  assert.deepEqual((await call('GET', `/social/watch?kind=discussion&id=${d.json.id}`, undefined, { 'x-tenant-id': READER })).json, { watching: true })

  // Same wall as reading it (COMMONS-13: watching needs only visibility).
  const denied = await call('POST', '/social/watch', { subject: { kind: 'project', id: projectId }, watching: true }, { 'x-tenant-id': STRANGER })
  assert.equal(denied.status, 404)
  const malformed = await call('POST', '/social/watch', { subject: { kind: 'planet', id: 'x' }, watching: true }, { 'x-tenant-id': READER })
  assert.equal(malformed.status, 400, 'an undeclared kind is refused, never stored')
})

test('recently viewed: a per-principal ledger — deduped, ordered by last open, capped', async () => {
  const a = await publishedProject()
  const b = await publishedProject()
  const seen = async (tenant: string) => {
    const feed = (await call('GET', '/commons', undefined, { 'x-tenant-id': tenant })).json
    return [a, b].map((f) => feed.find((i: any) => i.subject.id === f.projectId)?.viewedAt)
  }
  assert.deepEqual(await seen(READER), [undefined, undefined])

  await call('POST', '/social/viewed', { subject: { kind: 'project', id: a.projectId } }, { 'x-tenant-id': READER })
  await call('POST', '/social/viewed', { subject: { kind: 'project', id: b.projectId } }, { 'x-tenant-id': READER })
  const [aAt, bAt] = await seen(READER)
  assert.ok(typeof aAt === 'number' && typeof bAt === 'number', 'both viewed')
  assert.ok(bAt >= aAt, 'the ledger records WHEN, so the lens can order by it')

  // Re-opening MOVES the entry rather than adding one: the lens is "the last N
  // things you looked at", not "the last N times you looked".
  await call('POST', '/social/viewed', { subject: { kind: 'project', id: a.projectId } }, { 'x-tenant-id': READER })
  const [aAgain] = await seen(READER)
  assert.ok(aAgain >= bAt, 'the re-view moved it to the front')

  // Per principal: another reader's ledger is untouched.
  assert.deepEqual(await seen(OWNER), [undefined, undefined])

  // A subject the caller can't read is dropped SILENTLY — a refusal here would
  // answer "does this exist?" for anything a page happened to mount.
  const quiet = await call('POST', '/social/viewed', { subject: { kind: 'project', id: a.projectId } }, { 'x-tenant-id': STRANGER })
  assert.equal(quiet.status, 200)
  assert.deepEqual(await seen(STRANGER), [undefined, undefined])
  const bad = await call('POST', '/social/viewed', { subject: { id: 'x' } }, { 'x-tenant-id': READER })
  assert.equal(bad.status, 400)
})

test('every rail lens has a predicate and an empty state — both directions', () => {
  // Derived from the registry, not hand-listed: a lens added to the rail
  // without a predicate would silently show the WHOLE feed, which reads as
  // "you watch everything" rather than as a bug.
  const src = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const table = (name: string): string => {
    const at = src.indexOf(`const ${name}: Record<string,`)
    assert.ok(at > 0, `${name} exists in SectionView`)
    return src.slice(at, src.indexOf('\n}', at))
  }
  const holds = table('LENS_HOLDS')
  const empty = table('LENS_EMPTY')
  const ids = COMMONS_LENSES.map((s) => s.id)
  assert.ok(ids.length >= 4, 'the scan has subjects')
  for (const id of ids) {
    assert.match(holds, new RegExp(`\\b${id}:`), `the ${id} lens has a predicate`)
    assert.match(empty, new RegExp(`\\b${id}:`), `the ${id} lens names the act that fills it`)
  }
  // …and no predicate for a lens the rail doesn't offer (a stale entry would be
  // dead code claiming to be a feature).
  for (const key of [...holds.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])) {
    assert.ok(ids.includes(key), `${key} is a lens the rail actually offers`)
  }
  // Each predicate reads the SERVER's viewer-relative field — never a client
  // re-derivation from the actor name or the cached identity.
  for (const field of ['i.watched', 'i.liked', 'i.mine', 'i.viewedAt']) {
    assert.ok(holds.includes(field), `a lens filters on the server-stamped ${field}`)
  }
})
