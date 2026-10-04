import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A failed ACL read is not an empty ACL. The bundled helper calls Darwin's
 * descriptor API directly and has no write operation or path argument. */
export function inspectDarwinProfileAcl(fd, {
  helperPath = fileURLToPath(new URL('./bin/profile-acl', import.meta.url)),
  run = spawnSync,
} = {}) {
  const result = run(helperPath, [], {
    stdio: ['ignore', 'pipe', 'pipe', fd],
    env: {}, encoding: 'utf8', timeout: 5_000, maxBuffer: 1_024,
  })
  if (result.error || result.signal || result.status !== 0 || result.stdout !== 'private\n' || result.stderr !== '') {
    throw new Error('Private profile ACL could not be established.')
  }
}

export function desktopProfileAclInspector({ packaged, resourcesPath }) {
  const helperPath = desktopProfileAclHelperPath({ packaged, resourcesPath })
  return fd => inspectDarwinProfileAcl(fd, { helperPath })
}

export function desktopProfileAclHelperPath({ packaged, resourcesPath }) {
  return packaged ? join(resourcesPath, 'profile-acl') : fileURLToPath(new URL('./bin/profile-acl', import.meta.url))
}
