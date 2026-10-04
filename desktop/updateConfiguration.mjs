import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { assertUpdateBaseUrl, parseStableVersion } from './updateMetadata.mjs'

function readPlistBaseUrl(path) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/plutil', ['-extract', 'AgentCommonsUpdateBaseURL', 'raw', '-o', '-', path],
      { encoding: 'utf8', timeout: 2_000, maxBuffer: 4096 }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.replace(/\r?\n$/, ''))
      })
  })
}

/** Only signed-bundle configuration supplies network authority. An unsigned
 * ordinary package has no key; no environment/renderer fallback is admitted. */
export async function loadDesktopUpdateConfiguration({
  packaged, development, platform, architecture, currentVersion, resourcesPath,
  readBaseUrl = readPlistBaseUrl,
}) {
  if (!packaged || development || platform !== 'darwin') return null
  if (!['arm64', 'x64'].includes(architecture)) return null
  let baseUrl
  try { baseUrl = await readBaseUrl(join(resourcesPath, '..', 'Info.plist')) }
  catch { return null }
  assertUpdateBaseUrl(baseUrl)
  parseStableVersion(currentVersion)
  return Object.freeze({ baseUrl, architecture, currentVersion })
}
