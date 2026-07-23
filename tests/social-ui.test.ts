/** SOCIAL-5 funnel locks (docs/design/social-layer.md §3.1): the share-tier cue
 *  has ONE home (src/lib/tierBadge.ts + the shared <TierBadge>), and the grants
 *  UI reads through the one door (hooks/commands — no component knows the URL).
 *  The node harness has no DOM, so the panel's rendering is verified in-app;
 *  these locks keep the primitives from drifting (the copy-button pattern). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filesUnder } from './helpers/source.ts'
import { SHARE_TIERS } from '../contract/social.ts'
import { TIER_LABELS, TIER_BADGE_CLASS } from '../src/lib/tierBadge.ts'

// The ONE source walker (tests/helpers/source.ts) — it THROWS when a scan
// matches nothing, so these enumerating locks can't quietly pass over zero
// files. A second local walker was exactly the drift that rule prevents.
const SRC = 'src'
const walk = (dir: string) => filesUnder(dir)

test('TIER_LABELS covers exactly the contract tiers (one label map, in tier order)', () => {
  assert.deepEqual(Object.keys(TIER_LABELS), [...SHARE_TIERS])
  for (const t of SHARE_TIERS) assert.ok(TIER_LABELS[t].trim().length > 0)
})

test('the tier pill has ONE home: no component re-hardcodes the badge class or a tier-label map', () => {
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    if (f.endsWith(`lib${join('/', 'tierBadge.ts')}`) || f.replace(/\\/g, '/').endsWith('lib/tierBadge.ts')) continue
    const src = readFileSync(f, 'utf8')
    if (src.includes(TIER_BADGE_CLASS)) offenders.push(`${f}: badge class re-hardcoded`)
    // A second label map would map 'co-own' to display text outside the funnel.
    if (/['"]co-own['"]\s*:/.test(src)) offenders.push(`${f}: tier label map re-declared`)
  }
  assert.deepEqual(offenders, [])
})

test('the grants UI goes through the one door: no component/controller carries the /grants URL', () => {
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    const norm = f.replace(/\\/g, '/')
    if (norm.endsWith('api/keys.ts')) continue // the ONE home for paths
    if (readFileSync(f, 'utf8').includes('/grants')) offenders.push(f)
  }
  assert.deepEqual(offenders, [])
})

/** Preference may key on a NAME; authority never may. A display name is the
 *  wire's public identity — attacker-controlled (`createWorkspace` has no
 *  uniqueness guard) and renameable — so a control gated on `x.postedBy ===
 *  myName` is wrong in both directions: a renamed workspace loses an act it
 *  holds, and a colliding name is offered one that 403s. Every standing decision
 *  ships as a viewer-relative flag the server computed from raw tenant ids
 *  (`canRetract` / `canResolve` / `canDelete` / `own`).
 *
 *  Earned 2026-07-22: the work-item Retract control compared display names, on
 *  BOTH its surfaces, against a wire face that deliberately strips the ids a
 *  client would need to do it correctly. Muting stays name-keyed on purpose —
 *  it is a per-viewer preference, not an authorization (docs/evaluation.md). */
test('no UI control is gated by comparing a display name — authority rides a server flag', () => {
  // The REDACTED display-name fields the social / work payloads carry.
  const NAME_FIELDS = ['postedBy', 'openedBy', 'offeredBy', 'grantedBy', 'retractedBy']
  const norm = (p: string) => p.split('\\').join('/')
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    // Whitespace-collapsed so the check is plain substring matching — a hand-
    // escaped RegExp built from a JS string is exactly how the first version of
    // this lock shipped VACUOUS ('\.' in a string literal is just '.').
    const src = readFileSync(f, 'utf8').replace(/\s+/g, ' ')
    for (const field of NAME_FIELDS) {
      // `.field ===` / `.field !==` — comparing the NAME itself. Rendering a
      // name is fine; deciding with it is not.
      if (src.includes(`.${field} ===`) || src.includes(`.${field} !==`)) {
        offenders.push(norm(f).split('/src/')[1] + ': ' + field)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'gate on the server-computed flag (canRetract / canResolve / canDelete / own), never on a display name',
  )
})

test('a thread title has ONE home: no surface re-slices a post body to make one', () => {
  // `discussionTitle` (contract/social.ts) was earned by the 2026-07-22 judgment
  // pass — a bare slice cuts mid-word and reads as broken rather than
  // abbreviated — and its comment already named the RAIL LIST as a subject. The
  // Discussions section row had been missed and still cut at 100 chars with no
  // ellipsis; the seeded thread (2026-07-23) made it visible. Enumerate the
  // class rather than fix the instance: any surface deriving a title from a post
  // body must call the funnel.
  let renders = 0
  for (const f of walk(SRC)) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('posts[0]') || !/\bbody\b/.test(line)) return // reactions, ids, timestamps — not a title
      renders += 1
      // The call may wrap onto its own line, so read a small window around it.
      const window = lines.slice(Math.max(0, i - 2), i + 2).join(' ')
      assert.ok(
        window.includes('discussionTitle('),
        `${f}:${i + 1} derives a thread title from a post body without the funnel: ${line.trim()}`,
      )
    })
  }
  assert.ok(renders >= 1, 'at least one surface renders a thread title (the scan is not vacuous)')
})
