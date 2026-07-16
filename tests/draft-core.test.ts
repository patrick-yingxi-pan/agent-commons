/** Locking tests: the shared draft-session funnel (universal split Phase 6,
 *  src/controller/draftCore.ts) — the ONE flow that materializes the unsaved
 *  draft on first send, for every host (the singleton surface, a draft-hosting
 *  pane). Drives the pure factory with scripted deps, locking the coalesced
 *  materialization, the flush-BEFORE-send ordering (P6: bindings must land
 *  before the turn streams), the FWD-2 focus carry, the late model-pick flush,
 *  and the unreachable-server degradation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDraftController, type DraftDeps } from '../src/controller/draftCore.ts'
import { DRAFT_ID, EMPTY_LIVE, type Live } from '../src/data/liveSession.ts'
import type { Session } from '../contract/index.ts'
import type { PanelFocus } from '../src/types.ts'

const session = (id: string): Session => ({ id, title: 'T', updatedAt: '', preview: '' }) as unknown as Session

/** Scripted deps + a call log so ORDER is assertable. */
function fakeDeps(opts?: { failCreate?: boolean }) {
  const log: string[] = []
  const focuses = new Map<string, PanelFocus | null>()
  const lives = new Map<string, Live>()
  const prefs: Array<{ id: string; focus: PanelFocus | null }> = []
  const patches: Array<{ id: string; providerId: string; modelId: string }> = []
  let created = 0
  const deps: DraftDeps = {
    createSession: (text) => {
      created += 1
      log.push(`create:${text}`)
      return opts?.failCreate ? Promise.reject(new Error('unreachable')) : Promise.resolve(session(`real-${created}`))
    },
    attachContext: (sid, b) => {
      log.push(`attach:${sid}:${(b as { kind?: string }).kind ?? '?'}`)
      return Promise.resolve()
    },
    persistWorkspace: (sid) => {
      log.push(`persist:${sid}`)
      return Promise.resolve()
    },
    patchSession: (sid, p) => {
      patches.push({ id: sid, ...p })
      return Promise.resolve()
    },
    setPanelPref: (sid, f) => prefs.push({ id: sid, focus: f }),
    knownProviders: () => [{ id: 'anthropic', models: [{ id: 'claude-opus-4-8' }] }],
    defaultProviderId: 'anthropic',
    store: {
      get: (id) => ({ live: lives.get(id) ?? EMPTY_LIVE, focus: focuses.get(id) ?? null }),
      adopt: (from, to) => log.push(`adopt:${from}->${to}`),
      sendTurn: (id, text) => {
        log.push(`send:${id}:${text}`)
        return Promise.resolve()
      },
      reset: (id, live) => {
        lives.set(id, live)
        log.push(`reset:${id}`)
      },
      setLive: (id, live) => {
        lives.set(id, live)
      },
      setFocus: (id, f) => {
        focuses.set(id, f)
      },
    },
  }
  return { deps, log, prefs, patches, focuses, createdCount: () => created }
}

test('first send materializes, adopts, then streams under the real id — in that order', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  const adopted: string[] = []
  await draft.sendDraftTurn('hello', () => ({}), undefined, (sid) => adopted.push(sid))
  assert.deepEqual(adopted, ['real-1'])
  assert.deepEqual(log, ['create:hello', 'adopt:draft->real-1', 'send:real-1:hello'])
})

test('a rapid second send COALESCES into the first materialization (one session, two turns)', async () => {
  const { deps, log, createdCount } = fakeDeps()
  const draft = createDraftController(deps)
  await Promise.all([draft.sendDraftTurn('one', () => ({})), draft.sendDraftTurn('two', () => ({}))])
  assert.equal(createdCount(), 1, 'exactly ONE createSession for two quick sends')
  assert.ok(log.includes('send:real-1:one') && log.includes('send:real-1:two'), 'both turns stream under the one real id')
})

test('FWD-1 seeds flush BEFORE the turn streams (P6: tools derive from server-side contexts)', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)
  await draft.sendDraftTurn('go', () => ({}))
  const attachAt = log.findIndex((l) => l.startsWith('attach:real-1'))
  const sendAt = log.findIndex((l) => l.startsWith('send:real-1'))
  assert.ok(attachAt !== -1, 'the buffered context was attached to the real session')
  assert.ok(attachAt < sendAt, 'binding lands BEFORE the turn streams')
  // A second send has nothing left to flush (the buffer cleared).
  await draft.sendDraftTurn('again', () => ({}))
  assert.equal(log.filter((l) => l.startsWith('attach:')).length, 1)
})

test('clearBuffer abandons staged contexts (navigating away from the draft)', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)
  draft.clearBuffer()
  await draft.sendDraftTurn('go', () => ({}))
  assert.equal(log.some((l) => l.startsWith('attach:')), false, 'nothing flushed onto the new session')
})

test('the draft panel choice carries onto the real session (FWD-2), read from the STORE focus', async () => {
  const { deps, prefs } = fakeDeps()
  const draft = createDraftController(deps)
  deps.store.setFocus(DRAFT_ID, { kind: 'repo', id: 'r-1' })
  await draft.sendDraftTurn('go', () => ({}))
  assert.deepEqual(prefs, [{ id: 'real-1', focus: { kind: 'repo', id: 'r-1' } }])
})

test('a model pick changed WHILE materializing flushes as a sanitized PATCH; a stale pick degrades', async () => {
  const { deps, patches } = fakeDeps()
  const draft = createDraftController(deps)
  // Dispatch with no pick; by the post-materialize read the user picked a model.
  let pick: { providerId?: string; modelId?: string } = {}
  const p = draft.sendDraftTurn('go', () => pick)
  pick = { providerId: 'anthropic', modelId: 'claude-opus-4-8' }
  await p
  assert.deepEqual(patches, [{ id: 'real-1', providerId: 'anthropic', modelId: 'claude-opus-4-8' }])
  // A stale pick (unknown provider) sanitizes to the inherit default — no PATCH
  // (the dispatch capture and the late read agree after sanitize).
  const second = fakeDeps()
  const draft2 = createDraftController(second.deps)
  await draft2.sendDraftTurn('go', () => ({ providerId: 'deleted-provider', modelId: 'x' }))
  assert.equal(second.patches.length, 0, 'a sanitized-away pick never PATCHes')
})

test('unreachable server: the turn streams against the draft id, and a retry re-materializes', async () => {
  const { deps, log } = fakeDeps({ failCreate: true })
  const draft = createDraftController(deps)
  await draft.sendDraftTurn('go', () => ({}))
  assert.ok(log.includes(`send:${DRAFT_ID}:go`), 'graceful degradation — the reply still renders')
  // The coalesce handle was dropped, so a retry attempts a fresh createSession.
  await draft.sendDraftTurn('retry', () => ({}))
  assert.equal(log.filter((l) => l.startsWith('create:')).length, 2)
})

test('addSeed STACKS onto a fresh seeded draft (several picks build ONE thread) and all flush on send', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  draft.addSeed({ kind: 'repo', label: 'acme/api' } as never) // fresh blank → reset+seed
  draft.addSeed({ kind: 'connector', connector: { id: 'c1', kind: 'connector', name: 'Slack' } } as never) // stacks
  await draft.sendDraftTurn('go', () => ({}))
  const attaches = log.filter((l) => l.startsWith('attach:real-1'))
  assert.equal(attaches.length >= 2, true, `both seeds flushed before the turn (${attaches.join(', ')})`)
  assert.ok(log.indexOf(attaches[0]!) < log.indexOf('send:real-1:go'), 'flush precedes the stream')
})

test('reset seeds the draft entry and opens the seed panel; blank reset closes it', () => {
  const { deps, focuses } = fakeDeps()
  const draft = createDraftController(deps)
  draft.reset({ kind: 'repo', label: 'acme/api' } as never)
  assert.ok(focuses.get(DRAFT_ID), 'the seeded context panel auto-opens (focusForAdded)')
  draft.reset()
  assert.equal(focuses.get(DRAFT_ID), null, 'a blank draft starts with the panel closed')
})
