/** Per-conversation panel memory (FWD-2 / PD34) — the localStorage-backed store that
 *  remembers which panel a session had open. The load-bearing logic is the
 *  absent-vs-explicit-null distinction (no stored choice → fall back to strongestFocus;
 *  stored null → stay closed). Tested with a localStorage shim (the module reads it
 *  lazily per call, so installing the shim before the calls suffices). */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  acknowledgePanelPref,
  adoptServerPanelPref,
  getPanelPref,
  getPanelPrefState,
  setPanelPref,
} from './panelPrefs.ts'
import { setUiPrefScope } from './uiPrefs.ts'
import type { PanelFocus } from '../types.ts'

beforeEach(() => {
  setUiPrefScope(null)
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
})

test('an unset session returns undefined (caller falls back to the default)', () => {
  assert.equal(getPanelPref('s1'), undefined)
})

test('a stored focus round-trips; explicit null (closed) is distinct from unset', () => {
  setPanelPref('s1', { kind: 'repo', id: 'repo-x' } as PanelFocus)
  assert.deepEqual(getPanelPref('s1'), { kind: 'repo', id: 'repo-x' })

  setPanelPref('s1', null)
  assert.equal(getPanelPref('s1'), null, 'explicit closed is remembered, not treated as unset')

  assert.equal(getPanelPref('s2'), undefined, 'a different session stays unset')
})

test('a fresh module evaluation reads the persisted choice (survives a reload)', async () => {
  setPanelPref('s1', { kind: 'workspace', id: 'ws' } as PanelFocus)
  // A real reload = a brand-new module instance reading the SAME backing store. A
  // cache-busting query forces a fresh evaluation; this would fail if a module-level
  // cache were ever introduced (which a same-process re-read wouldn't catch).
  const fresh = await import('./panelPrefs.ts?reload=1')
  assert.deepEqual(fresh.getPanelPref('s1'), { kind: 'workspace', id: 'ws' })
})

test('preferences are account-scoped and inherit the legacy blob once', () => {
  setPanelPref('s1', { kind: 'repo', id: 'legacy' })
  setUiPrefScope('ada')
  assert.deepEqual(getPanelPrefState('s1'), { focus: { kind: 'repo', id: 'legacy' }, dirty: true })
  setPanelPref('s1', null)
  setUiPrefScope('grace')
  assert.deepEqual(getPanelPref('s1'), { kind: 'repo', id: 'legacy' })
  setPanelPref('s1', { kind: 'repo', id: 'grace' })
  setUiPrefScope('ada')
  assert.equal(getPanelPref('s1'), null)
})

test('dirty local intent beats a stale server read until the matching ack', () => {
  setPanelPref('s1', { kind: 'repo', id: 'local' })
  assert.deepEqual(adoptServerPanelPref('s1', { panelFocus: { kind: 'repo', id: 'server' } }), {
    kind: 'repo',
    id: 'local',
  })
  acknowledgePanelPref('s1', { kind: 'repo', id: 'server' }, { panelFocus: { kind: 'repo', id: 'server' } })
  assert.equal(getPanelPrefState('s1')?.dirty, true, 'a stale acknowledgement cannot clear the newer choice')
  acknowledgePanelPref('s1', { kind: 'repo', id: 'local' }, { panelFocus: { kind: 'repo', id: 'local' } })
  assert.equal(getPanelPrefState('s1')?.dirty, false)
  assert.equal(adoptServerPanelPref('s1', { panelFocus: null }), null)
})

test('a clean absent server value restores the default state', () => {
  setPanelPref('s1', null)
  acknowledgePanelPref('s1', null, { panelFocus: null })
  assert.equal(adoptServerPanelPref('s1', {}), undefined)
  assert.equal(getPanelPrefState('s1'), undefined)
})
