import { isIP } from 'node:net'

/** Release-owned configuration, never a renderer-supplied update destination. */
export function validateUpdateBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('AGENT_COMMONS_UPDATE_BASE_URL must be a canonical HTTPS directory URL.')
  }
  let url
  try { url = new URL(value) } catch {
    throw new Error('AGENT_COMMONS_UPDATE_BASE_URL must be a canonical HTTPS directory URL.')
  }
  const hostname = url.hostname
  if (url.protocol !== 'https:' || url.href !== value || !value.endsWith('/') ||
    url.username || url.password || url.search || url.hash || url.port || /[%\\]/.test(value) ||
    isIP(hostname) || !hostname.includes('.') || /(?:^|\.)(?:localhost|local)$/.test(hostname) ||
    !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('AGENT_COMMONS_UPDATE_BASE_URL must be a canonical public HTTPS directory URL without credentials, query, fragment or port.')
  }
  return value
}

function assertStableVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
    !version.split('.').every((part) => Number.isSafeInteger(Number(part)))) {
    throw new Error('Automatic update feeds require a stable three-part version with safe integer components.')
  }
}

/** Static Squirrel.Mac metadata generated only after both release candidates
 * pass finalization. No timestamp or mutable latest pointer is invented here.
 * This function does not fetch, download, install, or authorize an update. */
export function releaseUpdateFeedJson({ baseUrl, version, artifact }) {
  validateUpdateBaseUrl(baseUrl)
  assertStableVersion(version)
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(artifact)) ||
    Object.keys(artifact).sort().join(',') !== 'architecture,archiveName,bytes,sha256') {
    throw new Error('Update feed artifact must contain exactly architecture, archiveName, bytes and sha256.')
  }
  const { architecture, archiveName, bytes, sha256 } = artifact
  if (architecture !== 'arm64' && architecture !== 'x64') throw new Error('Update feed architecture must be arm64 or x64.')
  if (archiveName !== `Agent-Commons-${version}-macos-${architecture}.zip`) {
    throw new Error('Update feed archive must exactly match its version and architecture.')
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Update feed archive size must be a positive safe integer.')
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Update feed digest must be lowercase SHA-256.')
  return `${JSON.stringify({
    currentRelease: version,
    releases: [{
      version,
      updateTo: { version, url: `${baseUrl}${archiveName}`, name: version, sha256, size: bytes },
    }],
  }, null, 2)}\n`
}
