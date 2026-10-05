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
import type { WorkspaceFolder } from '../../contract/entities.ts'

const session = (id: string): Session => ({ id, title: 'T', updatedAt: '', preview: '' }) as unknown as Session

/** Scripted deps + a call log so ORDER is assertable. */
function fakeDeps(opts?: { failCreate?: boolean; failContextOnce?: boolean }) {
  const log: string[] = []
  const focuses = new Map<string, PanelFocus | null>()
  const lives = new Map<string, Live>()
  const prefs: Array<{ id: string; focus: PanelFocus | null }> = []
  const patches: Array<{ id: string; providerId: string; modelId: string }> = []
  let created = 0
  const creationKeys: string[] = []
  let contextAttempts = 0
  const contextRequests: Array<{ sid: string; operations: number }> = []
  const contextWorkspaces: unknown[] = []
  const createSources: Array<string | null | undefined> = []
  const frozenCreateSources: Array<boolean | undefined> = []
  const contextSources: Array<string | null | undefined> = []
  let currentSource: string | null = 'user-at-dispatch'
  const deps: DraftDeps = {
    createSession: (text, { idempotencyKey, expectedSessionUserId, freezeSessionWriteSource }) => {
      created += 1
      creationKeys.push(idempotencyKey)
      createSources.push(expectedSessionUserId)
      frozenCreateSources.push(freezeSessionWriteSource)
      log.push(`create:${text}`)
      return opts?.failCreate ? Promise.reject(new Error('unreachable')) : Promise.resolve(session(`real-${created}`))
    },
    updateContextState: (sid, request, expectedSessionUserId) => {
      contextAttempts += 1
      contextRequests.push({ sid, operations: request.operations.length })
      contextWorkspaces.push(request.workspace)
      contextSources.push(expectedSessionUserId)
      log.push(`context:${sid}:${request.operations.length}`)
      return opts?.failContextOnce && contextAttempts === 1
        ? Promise.reject(new Error('context unavailable'))
        : Promise.resolve()
    },
    captureSessionWriteSourceUserId: () => currentSource,
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
  return {
    deps, log, prefs, patches, focuses, contextRequests, contextWorkspaces, creationKeys, createSources, frozenCreateSources, contextSources,
    setCurrentSource: (source: string | null) => { currentSource = source },
    createdCount: () => created,
  }
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
  const { deps, log, contextSources } = fakeDeps()
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)
  await draft.sendDraftTurn('go', () => ({}))
  const attachAt = log.findIndex((l) => l.startsWith('context:real-1'))
  const sendAt = log.findIndex((l) => l.startsWith('send:real-1'))
  assert.ok(attachAt !== -1, 'the buffered context was attached to the real session')
  assert.ok(attachAt < sendAt, 'binding lands BEFORE the turn streams')
  assert.deepEqual(contextSources, ['user-at-dispatch'], 'the seed flush stays bound to the draft send source')
  // A second send has nothing left to flush (the buffer cleared).
  await draft.sendDraftTurn('again', () => ({}))
  assert.equal(log.filter((l) => l.startsWith('context:')).length, 1)
})

test('draft generation waits for the atomic binding + workspace acknowledgement', async () => {
  const { deps, log } = fakeDeps()
  let releaseContext!: () => void
  const contextWrite = new Promise<void>((resolve) => { releaseContext = resolve })
  deps.updateContextState = (sid, request) => {
    log.push(`context:${sid}:${request.operations.length}`)
    return contextWrite
  }
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)

  const sending = draft.sendDraftTurn('go', () => ({}))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(log.includes('send:real-1:go'), false, 'generation cannot outrun its authorization binding')

  releaseContext()
  await sending
  assert.ok(log.includes('send:real-1:go'), 'the turn streams after both context facets commit')
})

test('clearBuffer abandons staged contexts (navigating away from the draft)', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)
  draft.clearBuffer()
  await draft.sendDraftTurn('go', () => ({}))
  assert.equal(log.some((l) => l.startsWith('context:')), false, 'nothing flushed onto the new session')
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
  const { deps, log, creationKeys } = fakeDeps({ failCreate: true })
  const draft = createDraftController(deps)
  await draft.sendDraftTurn('go', () => ({}))
  assert.ok(log.includes(`send:${DRAFT_ID}:go`), 'graceful degradation — the reply still renders')
  // Each send gets one bounded same-key reconciliation before it degrades; the
  // later manual Retry keeps that same logical identity too.
  await draft.sendDraftTurn('retry', () => ({}))
  assert.equal(log.filter((l) => l.startsWith('create:')).length, 4)
  assert.deepEqual(new Set(creationKeys), new Set([creationKeys[0]!]),
    'automatic reconciliation and manual Retry retain one durable creation identity')
})

test('a lost materialization response automatically recovers the exact committed session under its dispatch source', async () => {
  const { deps, log, createSources, frozenCreateSources, setCurrentSource } = fakeDeps()
  const rows = new Map<string, Session>()
  const keys: string[] = []
  let attempts = 0
  deps.createSession = (text, { idempotencyKey, expectedSessionUserId, freezeSessionWriteSource }) => {
    attempts += 1
    keys.push(idempotencyKey)
    createSources.push(expectedSessionUserId)
    frozenCreateSources.push(freezeSessionWriteSource)
    const represented = rows.get(idempotencyKey) ?? session(`real-${rows.size + 1}`)
    rows.set(idempotencyKey, represented)
    if (attempts === 1) {
      setCurrentSource('user-after-switch')
      return Promise.reject(new Error('response lost after commit'))
    }
    return Promise.resolve(represented)
  }
  const draft = createDraftController(deps)
  await draft.sendDraftTurn('go', () => ({}))
  assert.equal(keys[1], keys[0])
  assert.deepEqual(createSources, ['user-at-dispatch', 'user-at-dispatch'], 'automatic same-key retry retains the frozen source')
  assert.deepEqual(frozenCreateSources, [true, true])
  assert.equal(rows.size, 1, 'one logical draft owns one server row')
  assert.ok(log.includes('adopt:draft->real-1'))
  assert.ok(log.includes('send:real-1:go'))
  assert.equal(log.includes(`send:${DRAFT_ID}:go`), false,
    'represented server truth wins before any ephemeral fallback')
})

test('draft materialization preserves an uncached source as absent across automatic retry', async () => {
  const { deps, createSources, frozenCreateSources, setCurrentSource } = fakeDeps()
  deps.captureSessionWriteSourceUserId = () => undefined
  let attempts = 0
  deps.createSession = (_text, options) => {
    createSources.push(options.expectedSessionUserId)
    frozenCreateSources.push(options.freezeSessionWriteSource)
    attempts += 1
    if (attempts === 1) {
      setCurrentSource('later-cached-user')
      return Promise.reject(new Error('response lost'))
    }
    return Promise.resolve(session('real-recovered'))
  }
  const draft = createDraftController(deps)
  await draft.sendDraftTurn('go', () => ({}))
  assert.deepEqual(createSources, [undefined, undefined])
  assert.deepEqual(frozenCreateSources, [true, true], 'absence is a frozen dispatch fact, not permission to recalculate on Retry')
})

test('a failed superseded materialization cannot clear or send into the new draft', async () => {
  const { deps, log } = fakeDeps()
  const attempts: Array<{ key: string; resolve: (value: Session) => void; reject: (error: Error) => void }> = []
  deps.createSession = (_text, { idempotencyKey: key }) => new Promise<Session>((resolve, reject) => {
    attempts.push({ key, resolve, reject })
  })
  const draft = createDraftController(deps)
  const abandoned = draft.sendDraftTurn('old', () => ({}))
  draft.reset()
  const current = draft.sendDraftTurn('new', () => ({}))
  attempts[0]!.reject(new Error('old response lost'))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(attempts[2]!.key, attempts[0]!.key, 'the abandoned request still reconciles only its own row')
  attempts[2]!.reject(new Error('old retry lost'))
  await abandoned
  const coalesced = draft.sendDraftTurn('newer', () => ({}))
  assert.equal(attempts.length, 3, 'the old rejection does not clear the new coalesce handle')
  assert.notEqual(attempts[1]!.key, attempts[0]!.key, 'reset begins a new durable identity')
  assert.equal(log.some((line) => line === `send:${DRAFT_ID}:old`), false,
    'the abandoned failure never targets the replacement draft')
  attempts[1]!.resolve(session('real-new'))
  await Promise.all([current, coalesced])
})

test('a failed context transaction retries against the already-created session instead of minting a duplicate', async () => {
  const { deps, log, createdCount } = fakeDeps({ failContextOnce: true })
  const draft = createDraftController(deps)
  draft.bufferContext({ kind: 'repo', label: 'acme/api' } as never)
  await draft.sendDraftTurn('go', () => ({}))
  assert.ok(log.includes(`send:${DRAFT_ID}:go`), 'the first attempt degrades without lying about durability')
  await draft.sendDraftTurn('retry', () => ({}))
  assert.equal(createdCount(), 1, 'retry reuses the materialized server row')
  assert.equal(log.filter((line) => line.startsWith('context:real-1')).length, 2, 'the idempotent transaction retries')
  assert.ok(log.includes('send:real-1:retry'), 'the recovered turn streams from the durable session')
})

test('addSeed STACKS onto a fresh seeded draft (several picks build ONE thread) and all flush on send', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  draft.addSeed({ kind: 'repo', label: 'acme/api' } as never) // fresh blank → reset+seed
  draft.addSeed({ kind: 'connector', connector: { id: 'c1', kind: 'connector', name: 'Slack' } } as never) // stacks
  await draft.sendDraftTurn('go', () => ({}))
  const transaction = log.find((l) => l === 'context:real-1:2')
  assert.ok(transaction, 'both seeds flush in one atomic transaction')
  assert.ok(log.indexOf(transaction) < log.indexOf('send:real-1:go'), 'flush precedes the stream')
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
  assert.ok(log.some((l) => l.startsWith('context:real-1')), 'the attach flushed at materialization')
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
  assert.equal(log.some((l) => l.startsWith('context:')), false, 'nothing stale flushed onto the real session')
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
  assert.deepEqual(log.filter((l) => l.startsWith('context:real-1')), ['context:real-1:1'], 'only the surviving connector seed flushed')
})

test('removeFolder purges an explicit empty served-folder seed with no artifact rows', async () => {
  const { deps, log } = fakeDeps()
  const draft = createDraftController(deps)
  const emptyFolder: WorkspaceFolder = { id: 'cloud::empty', label: 'Empty' }
  draft.attach({ kind: 'folder', label: 'Empty', folder: emptyFolder, artifacts: [], source: { id: 'cloud', kind: 'cloud', label: 'Cloud' } })
  draft.removeFolder(emptyFolder.id)
  await draft.sendDraftTurn('go', () => ({}))
  assert.equal(log.some((line) => line.startsWith('context:')), false, 'the explicit empty folder binding is not resurrected on first send')
})

test('a folder snapshot refreshed after draft intake survives first-send materialization', async () => {
  const { deps, contextWorkspaces } = fakeDeps()
  const draft = createDraftController(deps)
  const folderId = 'cloud::docs'
  draft.attach({
    kind: 'folder', label: 'Docs', folder: { id: folderId, label: 'Docs' },
    artifacts: [{ id: 'old-row', name: 'old.md', kind: 'doc', meta: '', source: { id: folderId, label: 'Docs' } }],
    source: { id: 'cloud', kind: 'cloud', label: 'Cloud' },
  } as never)
  const captured: WorkspaceFolder = {
    id: folderId, label: 'Docs', snapshot: {
      version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'docs',
      files: [{ name: 'new.md', sizeBytes: 3, snapshot: { text: 'new' } }],
    },
  }
  deps.store.setLive(DRAFT_ID, {
    ...deps.store.get(DRAFT_ID).live,
    workspaces: deps.store.get(DRAFT_ID).live.workspaces.map((workspace) => ({ ...workspace, artifacts: [], folders: [captured] })),
  })
  await draft.sendDraftTurn('go', () => ({}))
  const savedWorkspace = (contextWorkspaces[0] as { workspaces: Array<{ folders?: WorkspaceFolder[]; artifacts: unknown[] }> }).workspaces[0]!
  assert.equal(savedWorkspace.folders?.[0]?.snapshot?.snapshotId, captured.snapshot?.snapshotId)
  assert.deepEqual(savedWorkspace.artifacts, [], 'the refreshed folder is materialized from snapshot.files, not stale intake rows')
})
