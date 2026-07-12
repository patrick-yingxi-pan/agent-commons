/** Per-account view + layout memory (multi-account: a switch-back must find
 *  each account exactly where it was left). Locks the two client stores the
 *  keyed-Workspace remount reads at mount:
 *   - uiPrefs: the layout blob is SCOPED per account — accounts don't bleed
 *     into each other; a scope's first read seeds from the legacy unscoped
 *     blob (so an account starts from the layout the user already shaped) and
 *     the null scope still reads/writes the legacy blob;
 *   - viewMemory: locations round-trip per scope; a malformed blob degrades to
 *     "no memory", never a guess.
 *  (The restore choreography itself is DOM-bound — locked by
 *  e2e/account-switch.spec.ts's restore test.) */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// A minimal localStorage for the node harness (the modules read it lazily).
const backing = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
}

const { getLayout, setLayout, setUiPrefScope } = await import('../src/lib/uiPrefs.ts')
const { loadViewLocation, saveViewLocation } = await import('../src/lib/viewMemory.ts')

beforeEach(() => {
  backing.clear()
  setUiPrefScope(null)
})

test('layout prefs are scoped per account — no bleed between accounts or into the legacy blob', () => {
  setUiPrefScope('user-a')
  setLayout('leftW', 300)
  setUiPrefScope('user-b')
  setLayout('leftW', 400)

  setUiPrefScope('user-a')
  assert.equal(getLayout('leftW', 272), 300, "A reads A's width")
  setUiPrefScope('user-b')
  assert.equal(getLayout('leftW', 272), 400, "B reads B's width")
  setUiPrefScope(null)
  assert.equal(getLayout('leftW', 272), 272, 'the unscoped blob was never written')
})

test("a scope's FIRST read seeds from the legacy unscoped blob; its writes then diverge", () => {
  setLayout('leftW', 333) // the pre-multi-account layout the user shaped
  setLayout('leftOpen', false)

  setUiPrefScope('user-new')
  assert.equal(getLayout('leftW', 272), 333, 'first read falls through to the legacy blob')
  assert.equal(getLayout('leftOpen', true), false)
  setLayout('leftW', 350) // the first write copies the seed, then diverges
  assert.equal(getLayout('leftW', 272), 350)
  assert.equal(getLayout('leftOpen', true), false, 'the seeded sibling value came along')

  setUiPrefScope(null)
  assert.equal(getLayout('leftW', 272), 333, 'the legacy blob is untouched by scoped writes')
})

test('view locations round-trip per scope; unknown scopes and malformed blobs read as nothing', () => {
  saveViewLocation('user-a', { kind: 'session', sessionId: 's-42' })
  saveViewLocation('user-b', {
    kind: 'section',
    section: 'projects',
    subview: null,
    projectId: 'p-1',
    scheduleId: null,
    ownerName: null,
  })

  assert.deepEqual(loadViewLocation('user-a'), { kind: 'session', sessionId: 's-42' })
  assert.equal(loadViewLocation('user-b')!.kind, 'section')
  assert.equal((loadViewLocation('user-b') as { projectId: string | null }).projectId, 'p-1')
  assert.equal(loadViewLocation('user-c'), undefined, 'no memory for an unseen account')

  // A defective blob degrades to "no memory", never a throw or a guess.
  backing.set('claude-ui.view.v1', '{not json')
  assert.equal(loadViewLocation('user-a'), undefined)
  backing.set('claude-ui.view.v1', JSON.stringify({ 'user-a': { kind: 'bogus' } }))
  assert.equal(loadViewLocation('user-a'), undefined, 'an unknown kind is not a location')
})
