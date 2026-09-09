/** A body-edit acknowledgement is sufficient to publish the new exact body,
 * and independently refreshes every artifact-row projection without waiting
 * for the advisory SSE echo. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import type { ArtifactContentLibrary, ArtifactItem, RelationGraph } from '../../contract/index.ts'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { patchArtifactContent } from './commands.ts'
import { patchStructuredArtifactContent } from './structuredArtifactContent.ts'
import { keys } from './keys.ts'
import { peek, resetAll, setData } from './cache.ts'

const docRow: ArtifactItem = {
  id: 'artifact-doc-ack', name: 'ack.md', kind: 'doc', meta: 'Document', source: 'Conversation', projectId: '', editedAt: 1,
}
const sheetRow: ArtifactItem = {
  id: 'artifact-sheet-ack', name: 'ack.sheet', kind: 'sheet', meta: 'Sheet', source: 'Conversation', projectId: '', editedAt: 1,
}
const graph = { revision: 1, extraArtifacts: [docRow, sheetRow] } as RelationGraph
const docBefore = { type: 'doc', title: 'Ack', blocks: [{ p: 'before' }], revision: 0 } as const
const docAfter = { type: 'doc', title: 'Ack', blocks: [{ p: 'after' }], revision: 1 } as const
const sheetBefore = { type: 'sheet', columns: ['A'], rows: [['before']], revision: 0 } as const
const sheetAfter = { type: 'sheet', columns: ['A'], rows: [['after']], revision: 1 } as const

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

test('prose and structured acknowledgement paths publish once through the shared body funnel', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; resetAll() })
  setData<ArtifactItem[]>(keys.artifacts, [docRow, sheetRow])
  setData<RelationGraph>(keys.relations, graph)
  setData<ArtifactContentLibrary>(keys.artifactContent, {
    [docRow.id]: docBefore,
    [sheetRow.id]: sheetBefore,
  })
  const calls: Array<{ method?: string; body?: string | null }> = []
  globalThis.fetch = async (_input, init) => {
    calls.push({ method: init?.method, body: init?.body as string | null | undefined })
    return response(JSON.parse(String(init?.body)).content ? sheetAfter : docAfter)
  }

  const prose = await patchArtifactContent(docRow.id, { block: 0, text: 'after' }, 0, 'prose-key')
  const structured = await patchStructuredArtifactContent(sheetRow.id, {
    content: { type: 'sheet', columns: ['A'], rows: [['after']] },
  }, 0, 'structured-key')

  assert.equal(prose.revision, 1)
  assert.equal(structured.revision, 1)
  assert.deepEqual(peek<ArtifactContentLibrary>(keys.artifactContent)?.[docRow.id], docAfter)
  assert.deepEqual(peek<ArtifactContentLibrary>(keys.artifactContent)?.[sheetRow.id], sheetAfter)
  assert.deepEqual(calls.map((call) => call.method), ['PATCH', 'PATCH'], 'projection refresh never resubmits the acknowledged write')
})

test('accepted body acknowledgements directly refresh row and discovery projections without refetching the body', () => {
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const start = commands.indexOf('export function acceptArtifactContent(')
  const end = commands.indexOf('export async function reconcileArtifactContent', start)
  assert.ok(start >= 0 && end > start)
  const block = commands.slice(start, end)
  for (const key of ['artifacts', 'relations', 'commons']) {
    assert.ok(block.includes(`invalidate(keys.${key})`), `acknowledgement refreshes ${key} without an SSE event`)
  }
  for (const key of ['socialProposals', 'socialProposal', 'ownerProfile', 'search']) {
    assert.ok(block.includes(`invalidatePrefix(keys.${key}())`), `acknowledgement refreshes dependent ${key} reads`)
  }
  assert.doesNotMatch(block, /invalidate\(keys\.artifactContent\)/, 'the acknowledgement never recursively refetches its accepted body')
  assert.doesNotMatch(block, /apiGet|await |throw /, 'dependency refresh is advisory and cannot reject an acknowledged write')
})
