import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { desktopBackendEnvironment } from './runtime.mjs'
import { mcpOAuthChannels } from './mcpOAuthRuntime.mjs'

const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
const launcher = readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8')
const compact = value => value.replace(/\s+/g, ' ')

function assertWiring(source) {
  const text = compact(source)
  for (const expected of [
    'if (mcpCredentialVault) mcpOAuthRuntime = createDesktopMcpOAuthRuntime(',
    "if (event.senderFrame !== event.sender.mainFrame) throw new Error('MCP sign-in requires the main frame.')",
    'assertTrustedMcpCredentialCaller(event)',
    'mcpOAuthAvailable: Boolean(mcpOAuthRuntime)',
    'if (mcpOAuthRuntime) mcpOAuthBackend = createMcpOAuthCredentialHost(child,',
    'resolve: (reference, binding, options) => mcpOAuthRuntime.resolveCredential(reference, binding, options)',
    "...(mcpOAuthRuntime ? ['--agent-commons-mcp-oauth=true'] : [])",
    "if (cookie?.name === 'uw_session') { localFolderCookieGeneration += 1 resetMcpOAuthFlows()",
    'if (isMainFrame && !_inPlace) resetMcpOAuthFlows()',
    "win.webContents.on('render-process-gone', (_event, details) => { resetMcpOAuthFlows()",
    'mcpOAuthRuntime?.close()',
    'mcpOAuthBackend?.close()',
    'ipcMain.handle(channel, (event, request) => mcpOAuthReply(() => mcpOAuthRuntime.host[method](event, request)))',
  ]) assert.ok(text.includes(expected), `OAuth native wiring must retain: ${expected}`)
  assert.ok(source.indexOf('mcpOAuthRuntime = createDesktopMcpOAuthRuntime(') < source.indexOf('await launchBackend('),
    'the host must exist before the backend synchronization barrier')
  const session = source.slice(source.indexOf('async function readMcpOAuthSession()'), source.indexOf('function installMcpOAuthIpc()'))
  assert.equal(session.split('isMcpOAuthSessionCurrent(stamp)').length - 1, 2, 'cookie retrieval is fenced on both sides')
  assert.ok(text.includes('return !quitting && backendReady && Boolean(mainWindow && !mainWindow.isDestroyed()) &&'))
}

test('OAuth shipping bridge, child resolver and source lifetimes are wired through native authority only', () => {
  assertWiring(main)
  assert.throws(() => assertWiring(main.replace('if (isMainFrame && !_inPlace) resetMcpOAuthFlows()', '')), assert.AssertionError)
  for (const channel of Object.values(mcpOAuthChannels)) assert.ok(preload.includes(channel))
  assert.ok(launcher.includes("profile === 'desktop' && process.env.AGENT_COMMONS_MCP_OAUTH_AVAILABLE === 'true'"))
  assert.ok(launcher.includes('deviceOAuthAvailable: Boolean(mcpOAuthRuntime && mcpCredentialRuntime)'))
  assert.ok(launcher.indexOf('installMcpOAuthCredentialRuntime()') < launcher.indexOf("await import('../server/index.ts')"))
})

test('OAuth child availability is set by the native host, never inherited from ambient environment', () => {
  const options = { port: 12345, rendererOrigin: 'http://127.0.0.1:12345', userDataPath: '/private/native-oauth-test', authSecret: 'test',
    baseEnv: { AGENT_COMMONS_MCP_OAUTH_AVAILABLE: 'true' } }
  assert.equal(desktopBackendEnvironment(options).AGENT_COMMONS_MCP_OAUTH_AVAILABLE, 'false')
  assert.equal(desktopBackendEnvironment({ ...options, mcpOAuthAvailable: true }).AGENT_COMMONS_MCP_OAUTH_AVAILABLE, 'true')
  assert.equal(desktopBackendEnvironment({ ...options, mcpOAuthAvailable: 'true' }).AGENT_COMMONS_MCP_OAUTH_AVAILABLE, 'false')
})
