/** Per-conversation panel memory (FWD-2 / PD34) — the localStorage-backed store that
 *  remembers which panel a session had open. The load-bearing logic is the
 *  absent-vs-explicit-null distinction (no stored choice → fall back to strongestFocus;
 *  stored null → stay closed). Tested with a localStorage shim (the module reads it
 *  lazily per call, so installing the shim before the calls suffices). */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getPanelPref, setPanelPref } from '../src/lib/panelPrefs.ts'
import type { PanelFocus } from '../src/types.ts'

beforeEach(() => {
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
  const fresh = await import('../src/lib/panelPrefs.ts?reload=1')
  assert.deepEqual(fresh.getPanelPref('s1'), { kind: 'workspace', id: 'ws' })
})
