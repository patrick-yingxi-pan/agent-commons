/** Locking tests: the shared draft-session funnel (universal split Phase 6,
 *  src/controller/draftCore.ts) — the ONE flow that materializes the unsaved
 *  draft on first send, for every host (the singleton surface, a draft-hosting
 *  pane). Drives the pure factory with scripted deps, locking the coalesced
 *  materialization, the flush-BEFORE-send ordering (P6: bindings must land
 *  before the turn streams), the FWD-2 focus carry, the late model-pick flush,
 *  and the unreachable-server degradation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDraftController, type DraftDeps } from './draftCore.ts'
import { DRAFT_ID, EMPTY_LIVE, type Live } from '../data/liveSession.ts'
import type { Session } from '../../contract/index.ts'
import type { PanelFocus } from '../types.ts'

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

test('a reset() DURING materialization orphans the send: the turn still lands, but the NEW draft is not adopted away', async () => {
  // Control createSession so the reset lands mid-flight.
  const { deps, log } = fakeDeps()
  let release!: (s: Session) => void
  deps.createSession = (text) => {
    log.push(`create:${text}`)
    return new Promise<Session>((r) => {
      release = () => r(session('real-1'))
    })
  }
  const draft = createDraftController(deps)
  const adopted: string[] = []
  const inflight = draft.sendDraftTurn('hello', () => ({}), undefined, (sid) => adopted.push(sid))
  // The user starts a fresh draft (New session) while the first send is materializing.
  draft.reset()
  release(session('real-1'))
  await inflight
  // The turn still lands on the materialized session…
  assert.ok(log.includes('send:real-1:hello'), 'the orphaned turn still reaches the server')
  // …but the abandoned send must NOT adopt the fresh draft away or fire onAdopted
  // (that would blank the user's new draft / retarget their pane to the old session).
  assert.ok(!log.some((l) => l.startsWith('adopt:')), 'the fresh draft entry is not adopted away')
  assert.deepEqual(adopted, [], 'onAdopted does not fire for the orphaned send')
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

test('draft generation does not wait for workspace paint, while panel persistence does', async () => {
  const { deps, log } = fakeDeps()
  let releaseWorkspace!: () => void
  const workspaceWrite = new Promise<void>((resolve) => { releaseWorkspace = resolve })
  deps.persistWorkspace = (sid) => {
    log.push(`persist:${sid}`)
    return workspaceWrite
  }
  let panelBarrier: Promise<unknown> | undefined
  deps.setPanelPref = (_sid, _focus, ready) => { panelBarrier = ready }
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)

  const sending = draft.sendDraftTurn('go', () => ({}))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.ok(log.includes('send:real-1:go'), 'tool-ready generation is not delayed by a presentation write')
  assert.ok(panelBarrier, 'the panel write receives the still-pending workspace prerequisite')

  releaseWorkspace()
  await sending
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

test('attach (the composer semantic) STACKS and never resets — a mid-thread draft attach keeps its messages', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  // A degraded send left messages ON the draft entry (server unreachable) —
  // the exact state addSeed's launcher reset would have wiped.
  deps.store.setLive(DRAFT_ID, {
    ...EMPTY_LIVE,
    messages: [{ id: 'u1', role: 'user', content: 'hello' }],
  } as Live)
  draft.attach({ kind: 'connector', connector: { id: 'c1', kind: 'connector', name: 'Slack' } } as never)
  const live = deps.store.get(DRAFT_ID).live
  assert.equal(live.messages.length, 1, 'the in-progress thread survives the attach')
  assert.equal(live.connectors.length, 1, 'the context landed optimistically')
  assert.ok(!log.some((l) => l.startsWith('reset:')), 'attach never routes through reset')
  // …and the attach buffered, so it flushes onto the materialized session.
  await draft.sendDraftTurn('go', () => ({}))
  assert.ok(log.some((l) => l.startsWith('attach:real-1')), 'the attach flushed at materialization')
})

test('removeContexts purges the FWD-1 buffer — a removed chip never re-attaches at materialization', async () => {
  const { deps, log, focuses } = fakeDeps()
  const draft = createDraftController(deps)
  draft.attach({ kind: 'connector', connector: { id: 'c1', kind: 'connector', name: 'Slack' } } as never)
  assert.ok(focuses.get(DRAFT_ID), 'the attach opened its panel')
  draft.removeContexts([{ kind: 'connector', id: 'c1' }])
  assert.equal(deps.store.get(DRAFT_ID).live.connectors.length, 0, 'the chip is gone from the live')
  assert.equal(focuses.get(DRAFT_ID), null, 'the dangling panel cleared (focusValidIn)')
  await draft.sendDraftTurn('go', () => ({}))
  assert.equal(log.some((l) => l.startsWith('attach:')), false, 'nothing stale flushed onto the real session')
})

test('removeFolder purges exactly the removed folder seed; other seeds still flush', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  draft.attach({
    kind: 'folder',
    label: 'docs',
    artifacts: [{ id: 'a1', name: 'x', source: { id: 'src-docs' } }],
  } as never)
  draft.attach({ kind: 'connector', connector: { id: 'c1', kind: 'connector', name: 'Slack' } } as never)
  draft.removeFolder('src-docs')
  await draft.sendDraftTurn('go', () => ({}))
  const attaches = log.filter((l) => l.startsWith('attach:real-1'))
  assert.equal(attaches.length, 1, 'only the surviving connector seed flushed')
})
