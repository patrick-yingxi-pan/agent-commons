/** Project roles (docs/agent-commons.md, D14) — the GitHub-style permission baseline a
 *  Contributor's role sets, plus the lattice rank that orders acquisition-time
 *  arbitration. Pure contract, so the client can pre-check and the server enforces. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rolePermits, roleRank, PROJECT_ROLES, type ProjectAction } from '../contract/index.ts'

const ALL_ACTIONS: ProjectAction[] = ['read', 'write', 'reserve', 'fire', 'commission', 'configure']

test('rolePermits encodes the D14 baseline (reader ⊂ writer = maintainer ⊂ owner)', () => {
  // reader: read only.
  assert.equal(rolePermits('reader', 'read'), true)
  for (const a of ALL_ACTIONS.filter((x) => x !== 'read')) {
    assert.equal(rolePermits('reader', a), false, `reader denied ${a}`)
  }
  // writer + maintainer: work + reserve + fire, but not commission / configure.
  for (const role of ['writer', 'maintainer'] as const) {
    for (const a of ['read', 'write', 'reserve', 'fire'] as const) {
      assert.equal(rolePermits(role, a), true, `${role} permits ${a}`)
    }
    assert.equal(rolePermits(role, 'commission'), false)
    assert.equal(rolePermits(role, 'configure'), false)
  }
  // owner: everything.
  for (const a of ALL_ACTIONS) {
    assert.equal(rolePermits('owner', a), true, `owner permits ${a}`)
  }
})

test('roleRank ranks the lattice for acquisition-priority (owner > maintainer > writer > reader)', () => {
  assert.ok(roleRank('owner') > roleRank('maintainer'))
  assert.ok(roleRank('maintainer') > roleRank('writer'))
  assert.ok(roleRank('writer') > roleRank('reader'))
  // Distinct ranks across the whole lattice.
  assert.equal(new Set(PROJECT_ROLES.map(roleRank)).size, PROJECT_ROLES.length)
})

test('the permission baseline is monotone up the lattice (a higher role permits a superset)', () => {
  const byRankAsc = [...PROJECT_ROLES].sort((a, b) => roleRank(a) - roleRank(b))
  for (let i = 1; i < byRankAsc.length; i++) {
    for (const a of ALL_ACTIONS) {
      if (rolePermits(byRankAsc[i - 1], a)) {
        assert.equal(rolePermits(byRankAsc[i], a), true, `${byRankAsc[i]} ⊇ ${byRankAsc[i - 1]} on ${a}`)
      }
    }
  }
})
