/** ── The UI↔MCP sync rule (owner directive, 2026-08-09) ──────────────────────
 *  *"Always update the MCP interface of this website to keep the UI and MCP in
 *  sync."*
 *
 *  Most of that parity is already structural and needs no test to hold: the MCP
 *  tool catalog is GENERATED from the live route table and every `tools/call`
 *  re-enters the same router, so a route added tomorrow is a tool tomorrow with
 *  the same wall in front of it (INV-11, locked by `mcp-parity.test.ts`). A UI
 *  change that adds no route — this rail door, for one — needs no new tool, and
 *  inventing one would be the drift, not the fix.
 *
 *  What is NOT structural is the door's PROSE. `initialize` hands a machine
 *  caller instructions that point at places in the human UI ("mint a token in
 *  Contexts → …"), and nothing connects those words to the components that
 *  render them. It had already broken: the 2026-08-09 identity-copy pass
 *  retitled the panel from "This workspace is an MCP server" to "This account is
 *  an MCP server", and the MCP door kept sending callers to the old words. Every
 *  suite was green — the desync was invisible precisely because it crossed the
 *  boundary no test looked at.
 *
 *  So: every UI string the door quotes is declared in `MCP_UI_COPY` and must
 *  exist, verbatim, in the UI that renders it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MCP_UI_COPY, mcpInstructions } from './mcp.ts'
import { concatSource } from '../tests/helpers/source.ts'
import { SECTION_LABELS } from '../src/lib/nav.ts'

test('every UI string the MCP door quotes still exists in the UI', () => {
  // UI copy may live in a shared structural registry and be rendered by a
  // component (collectionSections is now the one home for this heading). Scan
  // the shipped UI layer, not only component literals; comments and suites are
  // still stripped/excluded by the shared helper, so prose cannot satisfy it.
  const ui = concatSource('src')
  assert.ok(
    ui.includes(MCP_UI_COPY.tokenPanel),
    `the MCP instructions send callers to "${MCP_UI_COPY.tokenPanel}", which no component renders`,
  )
  // The place it names is a real rail section, by its own label — so a renamed
  // or retired section fails here rather than stranding the caller.
  assert.ok(
    Object.values(SECTION_LABELS).includes(MCP_UI_COPY.section),
    `the MCP instructions name a "${MCP_UI_COPY.section}" section that the rail does not have`,
  )
})

test('the declared copy is what the instructions actually say', () => {
  // Without this the registry could sit correct-but-unused beside a bare
  // literal that drifted — the failure mode a one-home rule exists to prevent.
  const text = mcpInstructions()
  for (const [key, value] of Object.entries(MCP_UI_COPY)) {
    assert.ok(text.includes(value), `MCP_UI_COPY.${key} is declared but not quoted in the instructions`)
  }
  // And no stale spelling survives beside the live one.
  assert.ok(
    !text.includes('This workspace is an MCP server'),
    'the pre-2026-08-09 panel title is gone from the door’s prose',
  )
})
