/** Cross-platform atomic text replacement shared by live JSON persistence and
 * portable exports. The retry is for the Windows AV/indexer race where the
 * destination is momentarily held open during rename. */
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

function briefStall(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* bounded synchronous write path; only reached on rare rename contention */
  }
}

export function writeTextFileAtomically(
  file: string,
  contents: string,
  tempSuffix = '.tmp',
): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${file}${tempSuffix}`
  try {
    // Store snapshots and portable backups contain private workspace data.
    // Creating the replacement privately avoids a world-readable interval
    // before rename; Windows safely ignores this POSIX mode.
    writeFileSync(tmp, contents, { mode: 0o600 })
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(tmp, file)
        return
      } catch (err) {
        const code = (err as { code?: string }).code
        if ((code === 'EPERM' || code === 'EBUSY') && attempt < 3) {
          briefStall(15 * (attempt + 1))
          continue
        }
        throw err
      }
    }
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* preserve the original write/rename error */
    }
    throw err
  }
}
