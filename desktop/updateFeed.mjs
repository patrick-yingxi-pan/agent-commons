import { assertUpdateBaseUrl as validateUpdateBaseUrl, MAX_ARCHIVE_BYTES, parseStableVersion } from './updateMetadata.mjs'
export { validateUpdateBaseUrl }

/** Static Squirrel.Mac metadata generated only after both release candidates
 * pass finalization. No timestamp or mutable latest pointer is invented here.
 * This function does not fetch, download, install, or authorize an update. */
export function releaseUpdateFeedJson({ baseUrl, version, artifact }) {
  validateUpdateBaseUrl(baseUrl)
  parseStableVersion(version)
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
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Update feed archive size must be a positive safe integer up to 1 GiB.')
  }
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Update feed digest must be lowercase SHA-256.')
  return `${JSON.stringify({
    currentRelease: version,
    releases: [{
      version,
      updateTo: { version, url: `${baseUrl}${archiveName}`, name: version, sha256, size: bytes },
    }],
  }, null, 2)}\n`
}
