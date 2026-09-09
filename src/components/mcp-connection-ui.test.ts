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
  assert.match(catalog, /Refresh this catalog before attaching the server/)
  assert.match(catalog, /not a live health check/)
  assert.doesNotMatch(catalog, /dangerouslySetInnerHTML|MCP_OPTIONS|Markdown/)
})

test('execution-ready external MCP rows attach by their exact opaque identity', () => {
  const picker = source('components/AddContextButton.tsx')
  assert.match(picker, /useMcpConnections\(\)/,
    'the conversation picker reads the tenant-owned external connection registry')
  assert.match(picker, /connection\.execution === 'approval-required'/,
    'only execution-ready external rows become attachable')
  assert.match(picker, /isExternalMcpId\(c\.id\) \? c\.id : c\.id\.replace/,
    'external ids remain opaque while legacy fixture ids retain their adapter prefix')
  assert.match(picker, /connector: \{ id: m\.id, label: m\.label, kind: 'mcp' \}/,
    'an external row writes its exact registry id through the shared context funnel')
  assert.doesNotMatch(picker, /`mcp-\$\{m\.id\}`[\s\S]*external/,
    'the fixture namespace cannot be prepended to an external connection id')
})

test('an executable catalog promises per-call approval without becoming a run surface', () => {
  const catalog = source('components/McpCatalogBody.tsx')
  assert.match(catalog, /Every tool call requires your approval/)
  assert.match(catalog, /connection\.executableTools === undefined/,
    'only a legacy catalog without an admission decision is told to refresh')
  assert.match(catalog, /None of the advertised tools meet the supported schema policy/,
    'a current empty admission explains the schema incompatibility without promising refresh will cure it')
  assert.match(catalog, /connection\.execution === 'approval-required'/)
  assert.match(catalog, /executable\.has\(tool\.name\) \? 'text-ok-text' : 'text-ink-faint'/,
    'small executable status text uses the readable semantic success token')
  assert.doesNotMatch(catalog, /onClick=.*tool|Run tool/,
    'untrusted discovery metadata never becomes an executable catalog button')
})

test('Contexts describes the shipped inspect, attach, and per-call approval path', () => {
  const contexts = source('components/SectionView.tsx')
  assert.match(contexts, /Inspect a server, attach its admitted tools to a conversation, then approve each call before it runs\./)
  assert.doesNotMatch(contexts, /External server catalogs do not enable tool execution yet\./)
})

test('MCP forms retain one shell-owned act and use the narrow account-fenced token ceremony', () => {
  const page = source('components/McpConnectionPanel.tsx')
  assert.match(page, /useFocusTrap\(ref, onClose\)/)
  assert.match(page, /DIALOG_SURFACE_CLASS/)
  assert.match(page, /SCRIM_CLASS/)
  assert.match(page, /creationId: crypto\.randomUUID\(\)/)
  assert.match(page, /operationId: crypto\.randomUUID\(\)/)
  assert.match(page, /getMcpConnectionCredentialBinding\(connection\.id, me\.tenant\.id, sourceUserId\)/)
  assert.match(page, /provisionDesktopMcpCredential\(binding, token\)/)
  assert.equal((page.match(/generation !== accountGeneration\(\)/g) ?? []).length, 2)
  assert.match(page, /sourceUserId: me\.via === 'session' \? me\.user\.id : null/)
  assert.match(page, /expectedRevision: reviewed\.revision/)
  assert.doesNotMatch(page, /apiPost\(|fetch\(|localStorage|sessionStorage/)
  const shell = source('components/ShellMutationNotices.tsx')
  assert.equal((shell.match(/<McpConnectionMutationNotice \/>/g) ?? []).length, 1)
  assert.match(source('components/McpConnectionMutationNotice.tsx'), /kind="mcp-connection"/)
})

test('MCP lifecycle freezes the first-party principal and a failed lazy controller remains retryable', () => {
  const intent = source('api/mcpConnectionIntent.ts')
  const commands = source('api/mcpConnectionCommands.ts')
  const facade = source('controller/mcpConnectionMutations.ts')
  const credentials = source('api/desktopMcpCredentials.ts')
  assert.match(intent, /readonly sourceUserId: string \| null/)
  assert.match(commands, /expectedSessionUserId: intent\.sourceUserId/)
  assert.match(commands, /await mcpConnectionCreationId[\s\S]*assertScope\(intent, issuedGeneration\)/)
  assert.match(credentials, /expectedSessionUserId: sourceUserId/)
  assert.match(facade, /createRetryableRuntimeLoader<Runtime>/)
  assert.match(facade, /Couldn.t load the MCP connection controller\. Retry safely or Dismiss\./)
  assert.doesNotMatch(facade, /runtimePromise \?\?=/)
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
