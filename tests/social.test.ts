/** S0 locks for the social substrate (docs/design/social-layer.md §2.1):
 *  the tier order is strict and monotonic, the six nouns stay the relation
 *  graph's five plus Discussion, and the primitives' shared shapes stay
 *  kind-generic (no primitive core may branch on an entity kind — the
 *  orthogonality rule; adapters do that, registered elsewhere). */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SOCIAL_ENTITY_KINDS,
  SHARE_TIERS,
  tierRank,
  tierPermits,
} from '../contract/social.ts'
import { RELATIONS } from '../contract/relations.ts'

test('the six social nouns = the relation graph\'s five entities + discussion', () => {
  const relationEnds = new Set(RELATIONS.flatMap((r) => r.ends))
  for (const kind of relationEnds) {
    assert.ok(
      (SOCIAL_ENTITY_KINDS as readonly string[]).includes(kind),
      `relation entity "${kind}" must be a social noun`,
    )
  }
  assert.deepEqual(
    [...SOCIAL_ENTITY_KINDS].sort(),
    [...relationEnds, 'discussion'].sort(),
    'social nouns are exactly the relation entities plus discussion',
  )
})

test('share tiers are strictly ordered: view < comment < propose < co-own', () => {
  assert.deepEqual([...SHARE_TIERS], ['view', 'comment', 'propose', 'co-own'])
  const ranks = SHARE_TIERS.map(tierRank)
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] > ranks[i - 1], `tier ${SHARE_TIERS[i]} must outrank ${SHARE_TIERS[i - 1]}`)
  }
})

test('tierPermits is monotonic: a tier covers itself and everything below, nothing above', () => {
  for (const held of SHARE_TIERS) {
    for (const needed of SHARE_TIERS) {
      assert.equal(
        tierPermits(held, needed),
        tierRank(held) >= tierRank(needed),
        `tierPermits(${held}, ${needed})`,
      )
    }
  }
})

test('the substrate stays kind-generic: social.ts never branches on an entity kind', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../contract/social.ts', import.meta.url), 'utf8')
  // The kinds may be DECLARED (the const array) but never CONSULTED — no
  // comparison or switch against a specific noun outside the declaration.
  const body = src.replace(/export const SOCIAL_ENTITY_KINDS[\s\S]*?\] as const/, '')
  for (const kind of SOCIAL_ENTITY_KINDS) {
    assert.ok(
      !new RegExp(`===\\s*'${kind}'|case\\s+'${kind}'`).test(body),
      `contract/social.ts must not branch on entity kind '${kind}' (orthogonality rule)`,
    )
  }
})
