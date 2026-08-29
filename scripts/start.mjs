/** Release-shaped launcher. Resolve the chosen profile before importing the
 * server: auth signing, backend capability mode, persistence, and CORS headers
 * are intentionally selected during module evaluation. */
import { randomBytes } from 'node:crypto'
import { resolveRuntimeProfile } from '../server/runtimeProfile.ts'

const profile = process.argv[2] ?? 'desktop'
if (profile !== 'desktop' && profile !== 'web') {
  throw new Error(`Unknown deployment profile "${profile}". Use desktop or web.`)
}

const resolved = resolveRuntimeProfile(profile, process.env, () => randomBytes(32).toString('base64url'))
for (const [key, value] of Object.entries(resolved)) process.env[key] = value

console.log(`[startup] ${profile} profile · ${resolved.HOST}:${resolved.PORT} · ${resolved.PERSIST_BACKEND}`)
await import('../server/index.ts')
