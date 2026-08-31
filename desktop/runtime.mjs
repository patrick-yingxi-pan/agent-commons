import { createServer } from 'node:net'
import { join } from 'node:path'
import { isDesktopCredentialReference, validCredentialSecret } from './credentialProtocol.mjs'

const LOOPBACK_HOST = '127.0.0.1'

/** Reserve a currently free loopback port long enough to learn its number.
 * The Electron parent waits for the child-owned listen marker before loading
 * anything, so a process that wins the small close/fork race is never trusted. */
export async function findAvailableLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  if (!port) throw new Error('Could not reserve a loopback port for the desktop backend.')
  return port
}

export function loopbackOrigin(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Desktop backend port must be an integer from 1 to 65535; received "${port}".`)
  }
  return `http://${LOOPBACK_HOST}:${port}`
}

/** Renderer origins are local by construction in both release and HMR modes. */
export function exactLoopbackOrigin(raw) {
  const value = String(raw ?? '').trim()
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Desktop renderer URL must be an exact loopback origin; received "${value}".`)
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== LOOPBACK_HOST ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new Error(`Desktop renderer URL must be an exact http://${LOOPBACK_HOST}:<port> origin.`)
  }
  return value
}

export function isTrustedAppUrl(candidate, trustedOrigin) {
  try {
    const url = new URL(candidate)
    return !url.username && !url.password && url.origin === exactLoopbackOrigin(trustedOrigin)
  } catch {
    return false
  }
}

/** External navigation leaves Chromium only for ordinary credential-free HTTPS
 * URLs. Custom protocols and embedded credentials never reach the OS shell. */
export function isAllowedExternalUrl(candidate) {
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

/** Only a user-initiated sanitized clipboard write is needed by the current UI.
 * Reads, media capture, notifications, sensors, and device access stay denied. */
export function permissionAllowed(permission, requestingUrl, trustedOrigin) {
  return permission === 'clipboard-sanitized-write' && isTrustedAppUrl(requestingUrl, trustedOrigin)
}

/** Environment owned by the shell. Release posture is still resolved inside
 * scripts/start.mjs; these values bind it to this window and this OS user. */
export function desktopBackendEnvironment({ baseEnv = {}, providerCredentials = {}, port, rendererOrigin, userDataPath, authSecret }) {
  const backendOrigin = loopbackOrigin(port)
  const corsOrigin = exactLoopbackOrigin(rendererOrigin)
  if (!userDataPath || !authSecret) throw new Error('Desktop user-data path and process secret are required.')
  const inherited = Object.fromEntries(Object.entries(baseEnv).filter(([, value]) => value !== undefined))
  const credentials = Object.fromEntries(
    Object.entries(providerCredentials).filter(([reference, secret]) =>
      isDesktopCredentialReference(reference) && validCredentialSecret(secret),
    ),
  )
  return {
    ...inherited,
    ...credentials,
    PORT: String(port),
    CORS_ORIGIN: corsOrigin,
    AUTH_SECRET: authSecret,
    DATABASE_PATH: join(userDataPath, 'store.db'),
    SNAPSHOT_DIR: join(userDataPath, 'snapshots'),
    AGENT_COMMONS_BACKEND_ORIGIN: backendOrigin,
  }
}

export function backendListenMarker(origin) {
  return `[mock-backend] ${exactLoopbackOrigin(origin)}/api/v1`
}
