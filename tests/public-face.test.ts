/** Lock: the public-face cues have ONE source (form follows function — AGENTS.md).
 *  The owner byline ("by Ada Lab (you)") and the shared marker ("Shared · ") are
 *  minted only in src/lib/publicFace.ts / src/components/PublicFace.tsx; a component
 *  that re-hardcodes either re-opens the drift this funnel closed (the Discover
 *  subtitles once templated their own `by ${owner} (you)` strings). Source-level
 *  greps, like the other cue locks (tests/addTrigger.test.ts, tests/scrim.test.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AGENT_ACTOR_TITLE, agentActorLabel, bylineLabel, identityHue, identityInitial, profileTitle, SHARED_MARKER } from '../src/lib/publicFace.ts'

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('bylineLabel — the one owner label', () => {
  assert.equal(bylineLabel('Ada Lab', false), 'by Ada Lab')
  assert.equal(bylineLabel('Ada Lab', true), 'by Ada Lab (you)')
  assert.equal(bylineLabel(undefined, undefined), 'by this workspace')
})

test('profileTitle — the profile page title carries the same own-marker (D21)', () => {
  assert.equal(profileTitle('Ada Lab', false), 'Ada Lab')
  assert.equal(profileTitle('Ada Lab', true), 'Ada Lab (you)')
})

test('no component re-hardcodes the byline or the shared marker', () => {
  const sectionView = src('../src/components/SectionView.tsx')
  assert.ok(!/\(you\)/.test(sectionView), 'SectionView must derive "(you)" via bylineLabel, not inline it')
  assert.ok(!sectionView.includes(SHARED_MARKER), 'SectionView must render the shared marker via <Byline>, not inline it')
  assert.ok(/bylineLabel|<Byline/.test(sectionView), 'SectionView routes owner labels through the funnel')
  // The owner-door style is <OwnerLink>'s alone — the first review pass found the same
  // underline classes hand-rolled three times before this funnel existed.
  assert.ok(!sectionView.includes('decoration-line-strong'), 'the owner-door style lives in PublicFace (<OwnerLink>), never inline')

  const publicFace = src('../src/components/PublicFace.tsx')
  assert.ok(publicFace.includes("from '../lib/publicFace'"), 'the component imports the one label source')
  assert.ok(publicFace.includes('SHARED_MARKER'), 'the marker is referenced, not retyped')
})

test('agentActorLabel — the one agent-actor label (FWD-5 Phase 3)', () => {
  assert.equal(agentActorLabel('Canary Watcher'), 'Canary Watcher')
  assert.equal(agentActorLabel(undefined), 'a contributor', 'an unattributed legacy row still reads honestly')
})

test('the agent-actor cue has one home — components route through <AgentActor>/<ActorByline>', () => {
  const sectionView = src('../src/components/SectionView.tsx')
  assert.ok(/<AgentActor|<ActorByline/.test(sectionView), 'act bylines route through the funnel')
  assert.ok(!sectionView.includes(AGENT_ACTOR_TITLE), 'the tooltip is minted in lib/publicFace, never retyped')
  assert.ok(!sectionView.includes("'a contributor'"), 'the fallback label lives in agentActorLabel, never inline (the pre-funnel copy)')

  const publicFace = src('../src/components/PublicFace.tsx')
  assert.ok(publicFace.includes('AGENT_ACTOR_TITLE'), 'the badge component references the one tooltip source')
  assert.ok(publicFace.includes('agentActorLabel'), 'and the one label source')
})

test('the workspace identity mark is derived, deterministic, and bounded', () => {
  // Same name ⇒ same mark, everywhere — the whole point (no stored avatar state).
  assert.equal(identityHue('Acme, Inc.'), identityHue('Acme, Inc.'))
  assert.ok(identityHue('Personal') >= 0 && identityHue('Personal') < 360)
  // Different names should usually differ (spot-check the demo roster's names).
  const roster = ['Personal', 'Acme, Inc.', 'GrowthWorks', 'Northlight', 'Harbor Support', 'Rei Lab']
  assert.ok(new Set(roster.map(identityHue)).size >= roster.length - 1, 'the demo roster disambiguates')
  assert.equal(identityInitial('ada lab'), 'A')
  assert.equal(identityInitial('  émile'), 'É')
  assert.equal(identityInitial('   '), '?', 'a blank name reads honestly, like bylineLabel')
})

test('the mark has one home — <WorkspaceMark> in PublicFace; no component hand-rolls a name-hashed color', () => {
  const publicFace = src('../src/components/PublicFace.tsx')
  assert.ok(publicFace.includes('identityHue') && publicFace.includes('identityInitial'), 'the component derives from the one source')
  assert.ok(/aria-hidden/.test(publicFace), 'the mark is texture — the NAME stays the accessible identity')
  const sectionView = src('../src/components/SectionView.tsx')
  assert.ok(!/identityHue|identityInitial/.test(sectionView), 'components wear <WorkspaceMark>, never re-derive the mark')
  assert.ok(sectionView.includes('<WorkspaceMark'), 'the profile header wears the shared mark')
})
