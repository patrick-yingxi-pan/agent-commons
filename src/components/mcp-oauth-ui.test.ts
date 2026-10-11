import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('MCP OAuth entry is capability- and native-bridge-gated and preserves the bearer flow', () => {
  const panel = source('./McpConnectionPanel.tsx')
  assert.match(panel, /desktopMcpOAuthAvailable\(\) && catalog\.data\?\.capabilities\.deviceOAuthCredentials === true && me\?\.via === 'session'/)
  assert.match(panel, /connection\.authentication === 'device-oauth' && desktopMcpOAuthAvailable\(\) && list\.data\?\.capabilities\.deviceOAuthCredentials === true/)
  assert.match(panel, /connection\.authentication === 'device-oauth' && connection\.status === 'connected' && canOAuth/,
    'OAuth inspection is only available for a connected OAuth credential; setup/reconnect uses the OAuth flow, never bearer entry')
  assert.match(panel, /getMcpConnectionCredentialBinding/)
  assert.match(panel, /provisionDesktopMcpCredential/)
  assert.match(panel, /lazy\(\(\) => import\('\.\/DeferredMcpOAuthSetupDialog\.tsx'\)/)
  assert.match(panel, /class McpOAuthLoadBoundary extends Component/)
  assert.match(panel, /static getDerivedStateFromError\(\)/)
  assert.match(panel, /<McpOAuthLoadBoundary onClose=\{\(\) => setOauthOpen\(false\)\}>\s*<DeferredMcpOAuthSetupDialog[\s\S]*?<\/McpOAuthLoadBoundary>/,
    'the mounted lazy dialog is actually contained by its local loading/error boundary')
  assert.match(panel, /<Suspense fallback=\{<McpOAuthLoadShell failed=\{false\}/,
    'the OAuth chunk has a local loading shell and an adjacent error boundary')
  assert.match(panel, /Couldn’t load OAuth review/)
  assert.match(panel, /Reloading closes this review and clears unsent workspace text and in-memory recovery; the saved connection remains unchanged/)
  assert.match(panel, /data-bounded-dialog="mcp-oauth-load"/)
  assert.match(panel, /useBoundedDialog\(dialogRef\)/)
  assert.match(panel, /retryResourceQueries\(\[keys\.mcpConnections, keys\.mcpConnection\(id\)\]\)/)
})

test('OAuth review is explicit, account-pinned, scope opt-in, and never carries credentials or tool consent', () => {
  const dialog = source('./DeferredMcpOAuthSetupDialog.tsx')
  assert.match(dialog, /source: \{ tenantId, userId \}/)
  assert.match(dialog, /generation\.current = accountGeneration\(\)/)
  assert.match(dialog, /if \(!\(await pinOrStop\(\)\)\) return/,
    'account generation is checked before each native operation, not only after its response')
  assert.match(dialog, /reviewDesktopMcpOAuth\(\{ flowId: currentFlow\.flowId, issuer \}\)/)
  assert.match(dialog, /Continue to browser sign-in/)
  assert.match(dialog, /checked=\{selectedScopes\.includes\(scope\)\}/)
  assert.match(dialog, /setSelectedScopes\(\[\]\)/, 'scopes must start explicitly unselected')
  assert.match(dialog, /This window receives only the inspected connection status\. Tokens are stored encrypted on this Mac/)
  assert.match(dialog, /No token was exposed to this window/)
  assert.match(dialog, /No MCP tools are run or approved here/)
  assert.match(dialog, /data-bounded-dialog="mcp-oauth-review"/)
  assert.match(dialog, /dialogReadRegionProps\('OAuth sign-in review'\)/)
  assert.match(dialog, /useBoundedDialog\(dialogRef\)/)
  assert.match(dialog, /data-mcp-oauth-actions/)
  assert.match(dialog, /Check status/)
  assert.match(dialog, /cancelDesktopMcpOAuth/)
  assert.match(dialog, /queueMicrotask\(\(\) => \{[\s\S]*?if \(alive\.current && effectIdentity\.current === identity\) return/,
    'the cancellation cleanup ignores React StrictMode effect replay, but cancels on real unmount/source change')
  assert.match(dialog, /settleHeldDesktopMcpOAuthCancellation\(connection\.id, \{ tenantId, userId \}, currentFlow/,
    'late cleanup/cancel acknowledgements are bound to the exact flow handle')
  assert.match(dialog, /if \(!alive\.current\) \{\s*try \{\s*const cancelled = await cancelDesktopMcpOAuth\(\{ flowId: result\.flowId \}\)/,
    'a late start response is cancelled before it can publish an unowned flow')
  assert.match(dialog, /settleHeldDesktopMcpOAuthCancellation\(connection\.id, \{ tenantId, userId \}, result,[\s\S]*?cancelled\.status === 'inspection-pending'/,
    'late-start uncertainty is retained only if its exact flow still owns the recovery slot')
  assert.match(dialog, /const closeFlow = async \(\) => \{[\s\S]*?onClose\(\)\s*\}/,
    'Close and keep recovery releases the modal while retaining an uncertain flow')
  assert.match(dialog, /if \(result\.status === 'complete'\) \{\s*flow\.current = null\s*clearHeldDesktopMcpOAuthFlow/,
    'completion clears the local handle before unmount cleanup can recreate a stale recovery entry')
  assert.match(dialog, /code === 'expired' \|\| code === 'stale' \|\| code === 'conflict' \|\| code === 'cancelled'/,
    'terminal native failures discard unusable flow handles instead of offering dead scope retries')
  assert.doesNotMatch(dialog, /credentialReference|accessToken|refreshToken|rawMetadata|endpoint:/)
})
