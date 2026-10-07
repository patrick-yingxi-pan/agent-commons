import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(DESKTOP_ROOT, 'native', 'pdf-ocr-fixture.m')
const MODES = new Set(['scanned', 'blank', 'protected', 'pages101'])
const FIXTURE_MAX_BUFFER = 8 * 1024 * 1024
let fixtureDirectory
let fixtureExecutable

function fixtureGenerator() {
  if (fixtureExecutable) return fixtureExecutable
  if (process.platform !== 'darwin') throw new Error('Generated native PDF fixtures require macOS.')
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'agent-commons-pdf-ocr-fixture-'))
  const output = join(fixtureDirectory, 'pdf-fixture')
  const result = spawnSync('/usr/bin/clang', [
    '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-O2', SOURCE_PATH,
    '-framework', 'Foundation', '-framework', 'CoreGraphics', '-framework', 'CoreText', '-o', output,
  ], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/private/tmp' },
  })
  if (result.error) throw new Error('Could not compile the generated PDF fixture helper.', { cause: result.error })
  if (result.status !== 0) throw new Error(`Could not compile the generated PDF fixture helper${result.stderr ? `: ${result.stderr.trim()}` : '.'}`)
  chmodSync(output, 0o755)
  fixtureExecutable = output
  return output
}

/** Generate image-only pages, a blank document, a restricted-copy document,
 * or an over-page-limit document for native integration tests. */
export function pdfOcrFixture({ mode = 'scanned' } = {}) {
  if (!MODES.has(mode)) throw new Error('Generated PDF fixture mode is invalid.')
  const result = spawnSync(fixtureGenerator(), [mode], {
    encoding: 'buffer', timeout: 15_000, maxBuffer: FIXTURE_MAX_BUFFER,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/private/tmp' },
  })
  if (result.error) throw new Error('Could not generate a PDF fixture.', { cause: result.error })
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length === 0) throw new Error('Could not generate a PDF fixture.')
  return result.stdout
}

function cleanupFixtureGenerator() {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
  fixtureDirectory = undefined
  fixtureExecutable = undefined
}

process.once('exit', cleanupFixtureGenerator)
