/** Release-shaped launcher. Resolve the chosen profile before importing the
 * server: auth signing, backend capability mode, persistence, and CORS headers
 * are intentionally selected during module evaluation. */
import { randomBytes } from 'node:crypto'
import { resolveRuntimeProfile } from '../server/runtimeProfile.ts'
import { installCredentialRuntime } from '../desktop/credentialProtocol.mjs'
import { installDataRuntime } from '../desktop/dataProtocol.mjs'
import { installMcpCredentialRuntime } from '../desktop/mcpCredentialProtocol.mjs'
import { installMcpOAuthCredentialRuntime } from '../desktop/mcpOAuthCredentialProtocol.mjs'
import { installMcpStdioRuntime } from '../desktop/mcpStdioProtocol.mjs'

const profile = process.argv[2] ?? 'desktop'
if (profile !== 'desktop' && profile !== 'web') {
  throw new Error(`Unknown deployment profile "${profile}". Use desktop or web.`)
}

const resolved = resolveRuntimeProfile(profile, process.env, () => randomBytes(32).toString('base64url'))
for (const [key, value] of Object.entries(resolved)) process.env[key] = value
const credentialRuntime = installCredentialRuntime()
const mcpCredentialRuntime = installMcpCredentialRuntime()
const mcpOAuthRuntime = profile === 'desktop' && process.env.AGENT_COMMONS_MCP_OAUTH_AVAILABLE === 'true'
  ? installMcpOAuthCredentialRuntime() : null
const mcpStdioRuntime = profile === 'desktop' && process.platform === 'darwin' && process.env.AGENT_COMMONS_MCP_STDIO_AVAILABLE === 'true'
  ? installMcpStdioRuntime() : null
installDataRuntime()

console.log(`[startup] ${profile} profile · ${resolved.HOST}:${resolved.PORT} · ${resolved.PERSIST_BACKEND}`)
const { configureMcpRuntime } = await import('../server/mcpRuntime.ts')
configureMcpRuntime({
  resolveCredential: mcpCredentialRuntime ? (reference, binding) => mcpCredentialRuntime.resolve(reference, binding) : undefined,
  resolveOAuthCredential: mcpOAuthRuntime ? (reference, binding, options) => mcpOAuthRuntime.resolve(reference, binding, options) : undefined,
  synchronizeBindings: mcpCredentialRuntime
    ? (bindings) => mcpCredentialRuntime.synchronizeBindings(bindings)
    : undefined,
  // server/index.ts rehydrates durable state before calling the MCP startup
  // barrier. Never synchronize an empty pre-rehydration registry here: doing
  // so could retire valid device credentials before persistence is loaded.
  deviceBearerAvailable: false,
  deviceOAuthAvailable: Boolean(mcpOAuthRuntime && mcpCredentialRuntime),
  localProcessesAvailable: Boolean(mcpStdioRuntime),
  openStdio: mcpStdioRuntime ? (reference, binding, options) => mcpStdioRuntime.open(reference, binding, options) : undefined,
  synchronizeStdioBindings: mcpStdioRuntime ? bindings => mcpStdioRuntime.synchronize(bindings) : undefined,
  allowLoopback: false,
})
await import('../server/index.ts')
const { store } = await import('../server/store/index.ts')
// The store has rehydrated before server/index's import settles. Tell the
// Electron parent which generated references are still reachable so it can
// delete keys abandoned by a failed create or removed through a non-UI access
// door.
if (credentialRuntime) {
  credentialRuntime.announceBindings(store.providerCredentialBindings())
}
