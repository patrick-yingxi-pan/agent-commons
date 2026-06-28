/** Cross-user isolation (docs/agent-commons.md, D12) — a commissioned Agent executes
 *  under the *Project's* admitted authority, never its owner's ambient set. The
 *  effective reach is the agent's granted ceiling CLAMPED to what the Project admits
 *  (`intersectAuthority`), so a connector the Project doesn't admit is unreachable even
 *  to an Agent granted everything: default-deny, the make-or-break property. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { intersectAuthority, authorityAdmits, projectAdmittedAuthority } from '../contract/index.ts'
import { call } from './helpers/http.ts'

test('intersectAuthority clamps an unrestricted grant to the other side (the D12 wall)', () => {
  // An Agent granted everything, clamped to a Project that admits two connectors → it
  // reaches exactly those two. Default-deny on everything else.
  const eff = intersectAuthority({ connectors: ['*'] }, { connectors: ['Linear', 'Figma'] })
  assert.deepEqual(eff.connectors, ['Linear', 'Figma'])
  // Two concrete sets intersect.
  assert.deepEqual(
    intersectAuthority({ connectors: ['Linear', 'Slack'] }, { connectors: ['Linear', 'Figma'] }).connectors,
    ['Linear'],
  )
  // Both unrestricted stays unrestricted (the dimension is omitted).
  assert.equal(intersectAuthority({ tools: ['*'] }, {}).tools, undefined)
  // A Project admitting no connectors exposes none — even to an unrestricted Agent.
  assert.deepEqual(intersectAuthority({ connectors: ['*'] }, { connectors: [] }).connectors, [])
})

test('authorityAdmits: unrestricted or listed admits; otherwise denies', () => {
  assert.equal(authorityAdmits({ connectors: ['*'] }, 'connectors', 'Anything'), true)
  assert.equal(authorityAdmits({ connectors: ['Linear'] }, 'connectors', 'Linear'), true)
  assert.equal(authorityAdmits({ connectors: ['Linear'] }, 'connectors', 'Gmail'), false)
  // Absent dimension = unrestricted.
  assert.equal(authorityAdmits({}, 'tools', 'whatever'), true)
})

test('projectAdmittedAuthority derives connectors + scopes from the Project contexts', () => {
  const admitted = projectAdmittedAuthority([
    { kind: 'connector', label: 'Linear', meta: '' },
    { kind: 'connector', label: 'Figma', meta: '' },
    { kind: 'folder', label: '~/code/app', meta: '' },
    { kind: 'repo', label: 'org/app', meta: '' },
    { kind: 'doc', label: 'Spec', meta: '' },
  ])
  assert.deepEqual(admitted.connectors, ['Linear', 'Figma'])
  assert.deepEqual(admitted.scopes, ['~/code/app', 'org/app'])
  // A Project does not gate tools — they're the Agent's capability.
  assert.equal(admitted.tools, undefined)
})

test('store.commissionAuthority clamps the default Agent to the Project it joins (D12)', () => {
  // The seeded commission: the default Agent (unrestricted, via the provider) on the
  // guarded p-insights, which admits Linear + Figma. Its reach is exactly those — NOT
  // every connector, even though the Agent could reach everything.
  const eff = store.commissionAuthority('commission-insights-default')
  assert.ok(eff, 'the seeded commission resolves an effective authority')
  assert.deepEqual([...(eff!.connectors ?? [])].sort(), ['Figma', 'Linear'])
  // The owner's ambient connector (not admitted by the Project) is unreachable.
  assert.equal(store.commissionCanReach('commission-insights-default', 'connectors', 'Gmail'), false)
  // A Project-admitted connector is reachable.
  assert.equal(store.commissionCanReach('commission-insights-default', 'connectors', 'Linear'), true)
  // An unknown commission reaches nothing.
  assert.equal(store.commissionCanReach('nope', 'connectors', 'Linear'), false)
  assert.equal(store.commissionAuthority('nope'), undefined)
})

test('store.commissionAdmitsTarget walls a Contributor to the Project-admitted file scopes (D12, OQ3)', () => {
  // The seeded commission's effective scopes are p-insights' folder + repo roots
  // (~/code/insights-web, patrick-yingxi-pan/web-app) — the default Agent is unrestricted,
  // clamped to what the Project admits.
  const id = 'commission-insights-default'
  // Inside an admitted root → reachable (folder and repo alike).
  assert.equal(store.commissionAdmitsTarget(id, 'fs.read', '~/code/insights-web/main.ts'), true)
  assert.equal(store.commissionAdmitsTarget(id, 'fs.write', 'patrick-yingxi-pan/web-app/src/app.ts'), true)
  // Outside every admitted root → denied, even for an Agent granted everything (default-deny).
  assert.equal(store.commissionAdmitsTarget(id, 'fs.read', '~/secrets/keys.txt'), false)
  // A sibling that merely shares a string prefix is NOT under the root (scopeMatches boundary).
  assert.equal(store.commissionAdmitsTarget(id, 'fs.read', '~/code/insights-web-secret/x'), false)
  // Unknown commission reaches nothing — fail closed.
  assert.equal(store.commissionAdmitsTarget('nope', 'fs.read', '~/code/insights-web/main.ts'), false)
  // A non-fs capability carries no commission scope bound here (host grant + context mediation cover it).
  assert.equal(store.commissionAdmitsTarget(id, 'terminal', 'npm test'), true)
})

test('GET /commissions/:id/authority returns the effective reach; unknown 404s', async () => {
  const ok = await call('GET', '/commissions/commission-insights-default/authority')
  assert.equal(ok.status, 200)
  assert.deepEqual([...ok.json.connectors].sort(), ['Figma', 'Linear'])

  const missing = await call('GET', '/commissions/nope/authority')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})
