/** SOCIAL-5 funnel locks (docs/design/social-layer.md §3.1): the share-tier cue
 *  has ONE home (src/lib/tierBadge.ts + the shared <TierBadge>), and the grants
 *  UI reads through the one door (hooks/commands — no component knows the URL).
 *  The node harness has no DOM, so the panel's rendering is verified in-app;
 *  these locks keep the primitives from drifting (the copy-button pattern). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SHARE_TIERS } from '../contract/social.ts'
import { TIER_LABELS, TIER_BADGE_CLASS } from '../src/lib/tierBadge.ts'

const SRC = join(process.cwd(), 'src')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

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
