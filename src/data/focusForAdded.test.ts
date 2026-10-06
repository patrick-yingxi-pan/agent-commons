/** Unit tests for the pure panel-focus rules (src/data/liveSession.ts):
 *  focusForAdded — the rule mapping a just-attached context to the panel that
 *  should open (shared by the attach funnel and the FWD-1 entry shortcuts) —
 *  and focusValidIn — the rule every remove funnel runs so an open panel can't
 *  dangle on a context that was just detached. A drift in either silently
 *  changes which panel opens (or lingers) on a context change. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindingsFor, bucketFocuses, detachOperationsForFocuses, focusForAdded, focusValidIn, addContextToLive, EMPTY_LIVE, WS_ID, repoIdForLabel } from './liveSession.ts'
import type { AddedContext, PanelFocus } from '../types.ts'
import type { Live } from './liveSession.ts'

test('folder → the shared workspace panel it merged into', () => {
  const ctx = { kind: 'folder', label: 'docs', artifacts: [] } as unknown as AddedContext
  const live = addContextToLive(EMPTY_LIVE, ctx)
  assert.deepEqual(focusForAdded(ctx, live), { kind: 'workspace', id: live.workspaces[0]?.id ?? WS_ID })
})

test('repo → the repo panel keyed by repoIdForLabel', () => {
  const ctx = { kind: 'repo', label: 'acme/web-app', origin: 'github' } as unknown as AddedContext
  assert.deepEqual(focusForAdded(ctx, EMPTY_LIVE), { kind: 'repo', id: repoIdForLabel('acme/web-app') })
})

test('connector and mcp → the connector panel by its id', () => {
  const c = { kind: 'connector', connector: { id: 'gh', label: 'GitHub', kind: 'connector' } } as unknown as AddedContext
  assert.deepEqual(focusForAdded(c, EMPTY_LIVE), { kind: 'connector', id: 'gh' })
  const m = { kind: 'mcp', connector: { id: 'mcp-x', label: 'X', kind: 'mcp' } } as unknown as AddedContext
  assert.deepEqual(focusForAdded(m, EMPTY_LIVE), { kind: 'connector', id: 'mcp-x' })
})

test('files/photos → the first attachment; an empty attachment list → null', () => {
  const f = { kind: 'files', attachments: [{ id: 'a1', label: 'x', kind: 'file' }] } as unknown as AddedContext
  assert.deepEqual(focusForAdded(f, EMPTY_LIVE), { kind: 'file', id: 'a1' })
  const empty = { kind: 'files', attachments: [] } as unknown as AddedContext
  assert.equal(focusForAdded(empty, EMPTY_LIVE), null)
})

test('discussion → a read-only discussion focus with no effect binding', () => {
  const ctx = { kind: 'discussion', attachment: { id: 'discussion::thread-1', label: 'Thread', kind: 'discussion', discussionCaptureId: '11111111-1111-4111-8111-111111111111' } } as unknown as AddedContext
  const live = addContextToLive(EMPTY_LIVE, ctx)
  assert.deepEqual(live.attachments, [ctx.attachment])
  assert.deepEqual(focusForAdded(ctx, live), { kind: 'discussion', id: ctx.attachment.id })
  assert.equal(focusValidIn(live, { kind: 'discussion', id: ctx.attachment.id }), true)
  assert.deepEqual(bindingsFor(ctx), [], 'a discussion copy is reference data, not effect authority')
  assert.deepEqual(bucketFocuses([{ kind: 'discussion', id: ctx.attachment.id }]).attIds, new Set([ctx.attachment.id]))
  assert.deepEqual(detachOperationsForFocuses(live, [{ kind: 'discussion', id: ctx.attachment.id }]), [], 'removal does not synthesize a SessionContext detach binding')
})

test('focusValidIn: present contexts validate, absent ones do not — every panel kind', () => {
  const live = {
    ...EMPTY_LIVE,
    workspaces: [{ id: 'w1', label: 'w', artifacts: [] }],
    repos: [{ id: 'r1', label: 'o/r', origin: 'github', remote: 'o/r', branch: 'main', files: [], diff: [], terminal: [] }],
    connectors: [{ id: 'c1', label: 'GitHub', kind: 'connector' }],
    attachments: [{ id: 'a1', label: 'x', kind: 'file' }],
  } as unknown as Live
  const yes: PanelFocus[] = [
    { kind: 'workspace', id: 'w1' },
    { kind: 'repo', id: 'r1' },
    { kind: 'connector', id: 'c1' },
    { kind: 'file', id: 'a1' },
  ]
  for (const f of yes) assert.equal(focusValidIn(live, f), true, `${f.kind}:${f.id} is present`)
  const no: PanelFocus[] = [
    { kind: 'workspace', id: 'w2' },
    { kind: 'repo', id: 'r2' },
    { kind: 'connector', id: 'c2' },
    { kind: 'photo', id: 'a2' },
  ]
  for (const f of no) assert.equal(focusValidIn(live, f), false, `${f.kind}:${f.id} is absent`)
})

test('removing a shared workspace detaches every source-folder binding, not only its panel id', () => {
  const live = {
    ...EMPTY_LIVE,
    workspaces: [{
      id: WS_ID,
      label: 'Workspace',
      artifacts: [
        { id: 'a1', name: 'one', kind: 'doc', meta: '', source: { id: 'cloud::one', label: 'one/' } },
        { id: 'a2', name: 'two', kind: 'doc', meta: '', source: { id: 'runner::two', label: 'two/' } },
      ],
    }],
  } as unknown as Live
  assert.deepEqual(detachOperationsForFocuses(live, [{ kind: 'workspace', id: WS_ID }]), [
    { action: 'detach', contextId: WS_ID },
    { action: 'detach', contextId: 'cloud::one' },
    { action: 'detach', contextId: 'runner::two' },
  ])
})
