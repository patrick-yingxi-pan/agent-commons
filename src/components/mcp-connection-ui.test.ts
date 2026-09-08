import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

const source = (name: string) => stripComments(read(join(ROOT, 'src', name)))

test('real MCP identities open the authoritative shared catalog, never the fixture detail', () => {
  const panel = source('components/ConnectorPanel.tsx')
  const page = source('components/SectionView.tsx')
  assert.match(panel, /if \(isExternalMcpId\(connector\.id\)\) return <McpConnectionPreview/)
  assert.match(page, /if \(contextId && isExternalMcpId\(contextId\)\)/)
  assert.match(page, /<McpConnectionDetail key=\{contextId\}/)
  assert.match(page, /!isExternalMcpId\(ctx\.id\) && <div/)
  const catalog = source('components/McpCatalogBody.tsx')
  assert.match(catalog, /Tool execution is not available yet/)
  assert.match(catalog, /not a live health check/)
  assert.doesNotMatch(catalog, /dangerouslySetInnerHTML|MCP_OPTIONS|Markdown/)
})

test('MCP forms retain one shell-owned act and use the narrow account-fenced token ceremony', () => {
  const page = source('components/McpConnectionPanel.tsx')
  assert.match(page, /useFocusTrap\(ref, onClose\)/)
  assert.match(page, /DIALOG_SURFACE_CLASS/)
  assert.match(page, /SCRIM_CLASS/)
  assert.match(page, /creationId: crypto\.randomUUID\(\)/)
  assert.match(page, /operationId: crypto\.randomUUID\(\)/)
  assert.match(page, /getMcpConnectionCredentialBinding\(connection\.id, me\.tenant\.id\)/)
  assert.match(page, /provisionDesktopMcpCredential\(binding, token\)/)
  assert.equal((page.match(/generation !== accountGeneration\(\)/g) ?? []).length, 2)
  assert.match(page, /expectedRevision: reviewed\.revision/)
  assert.doesNotMatch(page, /apiPost\(|fetch\(|localStorage|sessionStorage/)
  const shell = source('components/ShellMutationNotices.tsx')
  assert.equal((shell.match(/<McpConnectionMutationNotice \/>/g) ?? []).length, 1)
  assert.match(source('components/McpConnectionMutationNotice.tsx'), /kind="mcp-connection"/)
})

test('MCP held removal rows remain the same render-only projection in page and rail', () => {
  for (const file of ['components/SectionView.tsx', 'components/SectionTreeChildren.tsx']) {
    assert.match(source(file), /useContextRegistryProjection\(\)/)
  }
  const projection = source('controller/useContextRegistryProjection.ts')
  assert.match(projection, /useSavedContexts\(\)/)
  assert.match(projection, /useMcpConnectionHeldViews\(\)/)
  assert.match(projection, /\.map\(mcpConnectionContext\)/)
  assert.doesNotMatch(projection, /setData|mutate\(|\.push\(/)
})

test('project page and rail resolve opaque MCP sources before legacy labels', () => {
  assert.match(source('components/SectionView.tsx'), /useContextDoor\(\)\(ctx\.label, ctx\.source\?\.id\)/)
  assert.match(source('components/SectionTreeChildren.tsx'), /resolveSavedContext\(saved, ctx\.label, ctx\.source\?\.id\)/)
})
