/** Deployment-profile resolution — one topology-neutral production seam.
 *
 * `npm run dev` remains the reviewable, auth-gated demo. Release-shaped boots
 * enter through `scripts/start.mjs`, which resolves one of these profiles before
 * importing any server module (several server choices are intentionally fixed at
 * module evaluation time). The desktop profile is the near-term target; the web
 * profile preserves the later hosted boundary and fails closed on its two
 * security-critical operator inputs.
 */

export type DeploymentProfile = 'desktop' | 'web'
type Env = Record<string, string | undefined>
export type RuntimeProfileEnv = Record<string, string>

const DEFAULT_PORT = '8787'

function portOf(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received "${value}".`)
  }
  return String(port)
}

function exactOrigin(raw: string | undefined, label: string): string {
  const value = raw?.trim()
  if (!value || value === '*') throw new Error(`${label} requires one exact CORS_ORIGIN; wildcard access is refused.`)
  if (!/^[a-z][a-z\d+.-]*:\/\/[^/\s]+$/i.test(value)) {
    throw new Error(`${label} CORS_ORIGIN must be an exact origin with no path or trailing slash.`)
  }
  return value
}

/** Resolve only the environment owned by the selected profile. The caller
 * applies this record before dynamically importing `server/index.ts`.
 * `freshSecret` is injected so the policy stays deterministic under test. */
export function resolveRuntimeProfile(
  profile: DeploymentProfile,
  env: Env = process.env,
  freshSecret: () => string,
): RuntimeProfileEnv {
  const port = portOf(env.PORT)

  if (profile === 'desktop') {
    const corsOrigin = exactOrigin(env.CORS_ORIGIN ?? `http://127.0.0.1:${port}`, 'The desktop profile')
    return {
      DEPLOYMENT_PROFILE: 'desktop',
      PORT: port,
      HOST: '127.0.0.1',
      BACKEND: 'mock',
      AUTH_GATE: 'off',
      IDENTITY_HEADERS: 'deny',
      AUTH_SECRET: env.AUTH_SECRET || freshSecret(),
      AUTH_COOKIE_SECURE: 'off',
      PERSIST_BACKEND: 'sqlite',
      INITIAL_WORLD: 'clean',
      MODEL_INLINE: '0',
      CONNECTOR_RUNTIME: 'unconfigured',
      CORS_ORIGIN: corsOrigin,
    }
  }

  const secret = env.AUTH_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new Error('The web profile requires AUTH_SECRET with at least 32 characters.')
  }
  const corsOrigin = exactOrigin(env.CORS_ORIGIN, 'The web profile')
  if (!corsOrigin.startsWith('https://')) {
    throw new Error('The web profile requires an https:// CORS_ORIGIN so Secure session cookies can work.')
  }
  const persistence = env.PERSIST_BACKEND?.trim().toLowerCase()
  if (persistence && persistence !== 'json' && persistence !== 'sqlite') {
    throw new Error(`The web profile supports PERSIST_BACKEND=json or sqlite; received "${env.PERSIST_BACKEND}".`)
  }
  return {
    DEPLOYMENT_PROFILE: 'web',
    PORT: port,
    HOST: env.HOST?.trim() || '0.0.0.0',
    BACKEND: 'remote',
    AUTH_GATE: 'require',
    IDENTITY_HEADERS: 'deny',
    AUTH_SECRET: secret,
    AUTH_COOKIE_SECURE: 'on',
    PERSIST_BACKEND: persistence === 'json' ? 'json' : 'sqlite',
    INITIAL_WORLD: 'clean',
    MODEL_INLINE: '0',
    CONNECTOR_RUNTIME: 'unconfigured',
    CORS_ORIGIN: corsOrigin,
  }
}
