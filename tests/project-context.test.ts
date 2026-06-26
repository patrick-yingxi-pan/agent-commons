/** The Projects detail page reuses the session composer's "Add context" picker to
 *  scope context to a project. That picker emits `AddedContext` (the session shape)
 *  and reads its "Added" ticks from a `Connector[]`; a project stores
 *  `ProjectContext`. These lock the pure mappers that bridge the two
 *  (src/lib/projectContext.ts) so the reuse can't silently drift: an added context
 *  always lands as the right ProjectContext, and an already-scoped connector is
 *  reverse-mapped to the catalog id the picker dedups against. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addedToProjectContexts,
  contextsToConnectors,
  projectContextTone,
} from '../src/lib/projectContext.ts'
import { CONNECTOR_OPTIONS, MCP_OPTIONS } from '../server/data/contextOptions.ts'
import type { ProjectContext } from '../contract/cowork.ts'

test('addedToProjectContexts maps each AddedContext kind to the right ProjectContext', () => {
  assert.deepEqual(
    addedToProjectContexts({ kind: 'folder', label: '~/code/web', artifacts: [{}, {}] as never }),
    [{ kind: 'folder', label: '~/code/web', meta: '2 files' }],
    'folder → folder, meta counts artifacts (pluralized)',
  )
  assert.deepEqual(
    addedToProjectContexts({ kind: 'folder', label: '~/x', artifacts: [{}] as never }),
    [{ kind: 'folder', label: '~/x', meta: '1 file' }],
    'a single artifact reads "1 file", not "1 files"',
  )
  assert.deepEqual(
    addedToProjectContexts({
      kind: 'repo',
      label: 'acme/web',
      origin: 'github',
      branch: 'main',
      files: [],
      diff: [],
      terminal: [],
    }),
    [{ kind: 'repo', label: 'acme/web', meta: 'github · main' }],
    'repo → repo, meta is "<origin> · <branch>"',
  )
  assert.deepEqual(
    addedToProjectContexts({ kind: 'connector', connector: { id: 'gh', label: 'GitHub', kind: 'github' } }),
    [{ kind: 'connector', label: 'GitHub', meta: 'Connector' }],
    'connector → connector tagged "Connector"',
  )
  assert.deepEqual(
    addedToProjectContexts({ kind: 'mcp', connector: { id: 'mcp-x', label: 'Postgres', kind: 'mcp' } }),
    [{ kind: 'connector', label: 'Postgres', meta: 'MCP server' }],
    'mcp → connector tagged "MCP server" (ProjectContext has no mcp kind)',
  )
})

test('files/photos fan out one ProjectContext per attachment', () => {
  assert.deepEqual(
    addedToProjectContexts({
      kind: 'files',
      attachments: [
        { id: 'f1', label: 'a.pdf', kind: 'file' },
        { id: 'f2', label: 'b.pdf', kind: 'file' },
      ],
    }),
    [
      { kind: 'doc', label: 'a.pdf', meta: 'File' },
      { kind: 'doc', label: 'b.pdf', meta: 'File' },
    ],
    'two files → two doc contexts',
  )
  assert.deepEqual(
    addedToProjectContexts({ kind: 'photos', attachments: [{ id: 'p1', label: 'shot.png', kind: 'photo' }] }),
    [{ kind: 'doc', label: 'shot.png', meta: 'Photo' }],
    'a photo → a doc context tagged "Photo"',
  )
})

test('projectContextTone maps each kind onto a chip palette tone', () => {
  assert.equal(projectContextTone('repo'), 'repo')
  assert.equal(projectContextTone('folder'), 'workspace')
  assert.equal(projectContextTone('doc'), 'file')
  assert.equal(projectContextTone('connector'), 'connector')
})

test('contextsToConnectors recovers catalog ids so the picker pre-ticks already-scoped connectors', () => {
  // Pick a real connector + MCP option so the label→id reverse lookup hits.
  const conn = CONNECTOR_OPTIONS[0]
  const mcp = MCP_OPTIONS[0]
  const scoped: ProjectContext[] = [
    { kind: 'connector', label: conn.label, meta: 'Connector' },
    { kind: 'connector', label: mcp.label, meta: 'MCP server' },
    { kind: 'repo', label: 'acme/web', meta: 'github · main' }, // not a connector → ignored
    { kind: 'folder', label: '~/x', meta: '3 files' }, // ignored
  ]
  const out = contextsToConnectors(scoped)
  assert.equal(out.length, 2, 'only connector-kind contexts map to connectors')

  const connector = out.find((c) => c.kind !== 'mcp')
  assert.equal(connector?.id, conn.id, 'connector id recovered from CONNECTOR_OPTIONS by label')

  const mcpOut = out.find((c) => c.kind === 'mcp')
  assert.equal(mcpOut?.id, `mcp-${mcp.id}`, 'mcp id carries the mcp- prefix the picker strips')
  assert.equal(
    mcpOut?.id.replace(/^mcp-/, ''),
    mcp.id,
    'stripping the prefix yields the catalog id the picker dedups against',
  )
})

test('contextsToConnectors falls back to the label when a scoped connector is not in the catalog', () => {
  // A label guaranteed absent from CONNECTOR_OPTIONS (a seed connector the picker
  // doesn't offer): there is no option id to recover, so the fallback keeps the
  // label — nothing throws, and the uncatalogued row simply isn't pre-ticked.
  const absent = 'Acme Internal Tool ∅'
  assert.equal(CONNECTOR_OPTIONS.some((o) => o.label === absent), false, 'precondition: label is not in the catalog')
  const out = contextsToConnectors([{ kind: 'connector', label: absent, meta: 'whatever' }])
  assert.deepEqual(out, [{ id: absent, label: absent, kind: 'connector' }])
})
