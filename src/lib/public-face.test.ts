/** Lock: the public-face cues have ONE source (form follows function — src/CLAUDE.md).
 *  The owner byline ("by Ada Lab (you)") and the shared marker ("Shared · ") are
 *  minted only in src/lib/publicFace.ts / src/components/PublicFace.tsx; a component
 *  that re-hardcodes either re-opens the drift this funnel closed (the Discover
 *  subtitles once templated their own `by ${owner} (you)` strings). Source-level
 *  greps, like the other cue locks (src/lib/addTrigger.test.ts, src/lib/scrim.test.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filesUnder, read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { AGENT_ACTOR_TITLE, agentActorLabel, bylineLabel, identityHue, identityInitial, profileTagline, profileTitle, SHARED_MARKER } from './publicFace.ts'

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('bylineLabel — the one owner label', () => {
  assert.equal(bylineLabel('Ada Lab', false), 'by Ada Lab')
  assert.equal(bylineLabel('Ada Lab', true), 'by Ada Lab (you)')
  assert.equal(bylineLabel(undefined, undefined), 'by an unknown owner')
})

test('profileTitle — the profile page title carries the same own-marker (D21)', () => {
  assert.equal(profileTitle('Ada Lab', false), 'Ada Lab')
  assert.equal(profileTitle('Ada Lab', true), 'Ada Lab (you)')
})

test('profileTagline names the OWNER, never the layer that owns', () => {
  assert.equal(profileTagline('Ada Lovelace'), 'Public profile — everything Ada Lovelace shares.')
})

test('the identity funnel says "workspace" nowhere a user can read it (2026-08-09)', () => {
  // A workspace is the layer FWD-5 Phase 2 DELETED — what owns and has a profile
  // is a NAMESPACE — and the word is still live in this app for two other things
  // (the adaptive split workspace; a context workspace = an attached folder). So
  // the ban is scoped to the identity FUNNEL, where the whole public face is
  // minted: ban it there and it cannot reach a profile, a byline or an owner
  // door anywhere, because every one of them routes through these two files (the
  // scans above are what make that true).
  //
  // COMMENT-STRIPPED on purpose: the rule cannot be stated without saying the
  // word, and an exemption keyed on the sentence that states it would pardon any
  // string that happened to contain the same spelling. Strip the prose and the
  // scan reads only what can reach a screen.
  for (const rel of [['src', 'lib', 'publicFace.ts'], ['src', 'components', 'PublicFace.tsx']]) {
    const file = join(ROOT, ...rel)
    const code = stripComments(read(file))
    assert.ok(code.length > 200, `${file} — the stripper left no code to scan (a vacuous pass)`)
    const hit = code.match(/\w*workspace\w*/i)
    assert.equal(hit, null, `${file} must name the OWNER, not the workspace layer — found "${hit?.[0]}"`)
  }
})

test('no component re-hardcodes the byline or the shared marker', () => {
  // Tree-wide, not SectionView-only. These scans used to grep that one file while
  // the rule they enforce is repo-wide, and the gap was not theoretical: the
  // owner-door style had escaped into artifactPreview.tsx AND into PublicFace.tsx
  // itself, both invisible to a single-file grep (see src/lib/text-door.test.ts,
  // docs/ui-invariants.md UI-16). Comment-stripped so the funnel's own prose —
  // which necessarily spells the cues out — can neither satisfy nor trip them.
  // Only lib/publicFace.ts is exempt — it MINTS both. PublicFace.tsx is scanned
  // like any other component: it spells the cues out in prose only, which
  // stripComments removes, so it must reference the constants, never retype them.
  for (const file of filesUnder('src')) {
    if (file.endsWith(join('lib', 'publicFace.ts'))) continue
    const source = stripComments(read(file))
    assert.ok(!/\(you\)/.test(source), `${file} must derive "(you)" via bylineLabel, not inline it`)
    assert.ok(!source.includes(SHARED_MARKER), `${file} must render the shared marker via <Byline>, not inline it`)
  }
  const sectionView = src('../components/SectionView.tsx')
  assert.ok(/bylineLabel|<Byline/.test(sectionView), 'SectionView routes owner labels through the funnel')
  // The owner-door style is <OwnerLink>'s alone — the first review pass found the same
  // underline classes hand-rolled three times before this funnel existed. The cue now
  // lives in lib/textDoor, and src/lib/text-door.test.ts owns its tree-wide ban.
  assert.ok(!sectionView.includes('decoration-line-strong'), 'the owner-door style lives in PublicFace (<OwnerLink>), never inline')

  const publicFace = src('../components/PublicFace.tsx')
  assert.ok(publicFace.includes("from '../lib/publicFace'"), 'the component imports the one label source')
  assert.ok(publicFace.includes('SHARED_MARKER'), 'the marker is referenced, not retyped')
})

test('agentActorLabel — the one agent-actor label (FWD-5 Phase 3)', () => {
  assert.equal(agentActorLabel('Canary Watcher'), 'Canary Watcher')
  assert.equal(agentActorLabel(undefined), 'a contributor', 'an unattributed legacy row still reads honestly')
})

test('the agent-actor cue has one home — components route through <AgentActor>/<ActorByline>', () => {
  const sectionView = src('../components/SectionView.tsx')
  assert.ok(/<AgentActor|<ActorByline/.test(sectionView), 'act bylines route through the funnel')
  // Tree-wide for the same reason as the byline scans above.
  for (const file of filesUnder('src')) {
    if (file.endsWith(join('lib', 'publicFace.ts'))) continue
    const source = stripComments(read(file))
    assert.ok(!source.includes(AGENT_ACTOR_TITLE), `${file} must take the tooltip from lib/publicFace, never retype it`)
    assert.ok(!source.includes("'a contributor'"), `${file} must take the fallback label from agentActorLabel, never inline it`)
  }

  const publicFace = src('../components/PublicFace.tsx')
  assert.ok(publicFace.includes('AGENT_ACTOR_TITLE'), 'the badge component references the one tooltip source')
  assert.ok(publicFace.includes('agentActorLabel'), 'and the one label source')
})

test('the identity mark is derived, deterministic, and bounded', () => {
  // Same name ⇒ same mark, everywhere — the whole point (no stored avatar state).
  assert.equal(identityHue('Acme, Inc.'), identityHue('Acme, Inc.'))
  assert.ok(identityHue('Personal') >= 0 && identityHue('Personal') < 360)
  // Different names should usually differ (spot-check the demo roster's names).
  const roster = ['Personal', 'Ada Lovelace', 'Grace Hopper', 'Maya Chen', 'Noor Haddad', 'Omar Diaz', 'Rei Tanaka']
  assert.ok(new Set(roster.map(identityHue)).size >= roster.length - 1, 'the demo roster disambiguates')
  assert.equal(identityInitial('ada lab'), 'A')
  assert.equal(identityInitial('  émile'), 'É')
  assert.equal(identityInitial('   '), '?', 'a blank name reads honestly, like bylineLabel')
})

test('the mark has one home — <IdentityMark> in PublicFace; no component hand-rolls a name-hashed color', () => {
  const publicFace = src('../components/PublicFace.tsx')
  assert.ok(publicFace.includes('identityHue') && publicFace.includes('identityInitial'), 'the component derives from the one source')
  assert.ok(/aria-hidden/.test(publicFace), 'the mark is texture — the NAME stays the accessible identity')
  // Tree-wide: any component re-deriving the name-hashed mark forks the identity.
  for (const file of filesUnder('src')) {
    if (file.endsWith(join('lib', 'publicFace.ts')) || file.endsWith(join('components', 'PublicFace.tsx'))) continue
    assert.ok(
      !/identityHue|identityInitial/.test(stripComments(read(file))),
      `${file} must wear <IdentityMark>, never re-derive the mark`,
    )
  }
  const sectionView = src('../components/SectionView.tsx')
  assert.ok(sectionView.includes('<IdentityMark'), 'the profile header wears the shared mark')
})

test('UI-13 — CreditLine is layout-self-contained (its own flex root, no caller contract)', () => {
  const publicFace = src('../components/PublicFace.tsx')
  // The primitive carries its own container: the function body opens with an
  // inline-flex gap-3 root, not a fragment relying on the caller's flex.
  const creditLine = publicFace.slice(publicFace.indexOf('function CreditLine'))
  assert.ok(
    /return \(\s*<span className="inline-flex flex-wrap items-center gap-x-3/.test(creditLine),
    'CreditLine roots its own wrapping inline-flex container (UI-13)',
  )
  assert.ok(
    !publicFace.includes('Render inside a'),
    'no layout contract on callers — the primitive is self-contained',
  )
})
