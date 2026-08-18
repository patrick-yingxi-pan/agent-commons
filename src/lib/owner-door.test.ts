/** ── The owner door, and the rail's standing door to your own profile ────────
 *  (Owner directive, 2026-08-09: "an entry in left panel to user's own social
 *  page … a sub-entry under Commons section since it is social profile instead
 *  of account profile.")
 *
 *  Two rules, one change.
 *
 *  **1. Which section HOSTS a namespace profile is ONE fact.** It used to be
 *  spelled `rel.navigate('agents', name)` at 22 call sites, plus four local
 *  aliases that were the same funnel invented four times — and the section it
 *  named was an accident (profiles were first reached from the Agents hub's
 *  Discover directory). The accident was visible: opening ANY profile lit and
 *  auto-expanded the Agents row in the rail. Now the fact lives in
 *  `OWNER_SECTION` and every byline, follower row, @-mention, credit line and
 *  roster entry goes through `useRelations().openOwner`.
 *
 *  **2. Your own profile has a standing door, and only one address.** The rail's
 *  "Your profile" child sits under the Commons beside the lenses (it is a place
 *  you go back to, like Watched or Posted — but the place is YOU). It is a DOOR
 *  to `/u/:name`, never a `/commons/profile` sub-view: one page, one URL. The
 *  no-second-address half is locked in `url-routes.test.ts`; this file locks the
 *  funnel, the composition, and the row. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, concatSource, read, stripComments } from '../../tests/helpers/source.ts'
import { OWNER_SECTION, seedFor } from './paneNav.ts'
import { SECTION_LABELS } from './nav.ts'
import { OWNER_PROFILE_DOOR, SECTION_CHILDREN, SECTION_SUBVIEWS } from './subviews.ts'

test('the profile is hosted by a NAMED section, and the name resolves', () => {
  assert.ok(OWNER_SECTION in SECTION_LABELS, 'OWNER_SECTION names a real section')
  assert.equal(OWNER_SECTION, 'commons', 'a profile is a SOCIAL page — the social section hosts it')
  // The seed mapping agrees, so a routed URL, the root bridge and a pane door
  // all resolve a name to the same detail page.
  assert.deepEqual(seedFor(OWNER_SECTION, 'Ada Lovelace'), { ownerName: 'Ada Lovelace' })
})

test('every owner door goes through the ONE funnel — no section literal at a call site', () => {
  // The shape a hand-rolled door takes: the nav bridge, a section literal, and
  // a name. Scanned comment-stripped over the whole UI tree, in the old
  // spelling AND the new one — re-pointing the constant must not leave a
  // regrown copy behind, which is exactly how the four local aliases appeared.
  const ui = concatSource('src')
  assert.doesNotMatch(
    ui,
    /navigate\('agents',\s*[^)]/,
    "no `navigate('agents', name)` — profiles left the Agents hub; use rel.openOwner",
  )
  assert.doesNotMatch(
    ui,
    new RegExp(`navigate\\('${OWNER_SECTION}',\\s*[^)]`),
    'no section literal + name at a call site — the host section has one home (OWNER_SECTION)',
  )
  // A bare hub jump is still fine — it names no entity, so it cannot drift.
  assert.match(ui, /navigate\('agents'\)/, "the Agents hub itself is still reachable")
})

test('the funnel exists, and is built from the PANE-composed navigate', () => {
  // `openOwner` composed inside the provider would close over the ROOT bridge,
  // so an owner byline inside a split pane would drive the primary pane instead
  // of its own — the pane-locality rule (ADAPT-17) broken silently, in the one
  // door that appears on nearly every surface. It is composed in `useRelations`
  // from the same `nav` the override produced.
  const rel = stripComments(read(join(ROOT, 'src', 'controller', 'useRelations.tsx')))
  assert.match(rel, /openOwner: \(name: string\) => void/, 'the bridge declares the door')
  assert.match(rel, /const nav = override \?\? ctx\.navigate/, 'one composed navigate')
  assert.match(
    rel,
    /return \{ \.\.\.ctx, navigate: nav, openOwner: \(name: string\) => nav\(OWNER_SECTION, name\) \}/,
    'openOwner is built FROM the composed navigate, so it is pane-local',
  )
})

test('the shared fixed-child registry carries the canonical door first under Commons', () => {
  const children = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.equal(SECTION_CHILDREN[OWNER_SECTION]?.[0], OWNER_PROFILE_DOOR)
  assert.equal(OWNER_PROFILE_DOOR.label, 'Your profile')
  assert.doesNotMatch(children, /OwnerProfileChild/, 'the door is not a rail-only component')
  assert.match(sidebar, /children\.map\(\(child\) => child\.kind === 'owner-profile'/)
  assert.match(sidebar, /label=\{child\.label\}/, 'every fixed child reads its shared label')
  assert.match(sidebar, /<SubNavRow\s/, 'the canonical door wears the same row primitive as every subview')
})

test('every fixed child kind makes its section expandable through the same registry', () => {
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.match(sidebar, /!!SECTION_CHILDREN\[id\] \|\| !!SECTION_INSTANCE_KEY\[id\]/)
  assert.ok(
    (SECTION_CHILDREN[OWNER_SECTION] ?? []).some((child) => child.kind === 'owner-profile'),
    'the canonical door itself participates in expandability',
  )
  assert.ok(!(SECTION_SUBVIEWS[OWNER_SECTION] ?? []).some((child) => child.id === 'profile'))
})

test('the door opens the NAMESPACE’s name, never the user’s', () => {
  // A profile is a namespace's face: the server's own existence rule is
  // `tenantName(tenantId) === name`, and the account menu's org rows already
  // door by `tenant.name`. On the seeded accounts the two names are equal
  // (that is what lib/accountFace is about), so a `user.name` door would work
  // by coincidence here and break for any account whose namespace was renamed.
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.match(sidebar, /const tenantName = me\?\.tenant\.name/, 'the door reads the namespace name')
  assert.doesNotMatch(sidebar, /const tenantName = me\?\.user\.name/, 'never the person name')
})

test('a profile open in the pane un-lights the Commons row — the child holds the highlight', () => {
  // The section row is "active" only on its own default view. The Commons is
  // the one section with a detail page but no instance key, so without this the
  // row would claim to be showing the feed while a profile filled the pane —
  // and the "Your profile" child would sit unlit underneath a lit parent.
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.match(
    sidebar,
    /id === OWNER_SECTION\s*\?\s*\(activeSeed\?\.ownerName \?\? null\)/,
    'the owner section derives its active detail from ownerName',
  )
  assert.match(
    sidebar,
    /active=\{activeSection === id && activeSeed\?\.ownerName === tenantName\}/,
    'and the child is lit only when the pane shows YOUR profile in this section',
  )
})
