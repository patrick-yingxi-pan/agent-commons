import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(DESKTOP_ROOT, 'native', 'image-ocr-fixture.m')
const MAX_FIXTURE_EDGE = 3000
const FIXTURE_MAX_BUFFER = 8 * 1024 * 1024

let fixtureDirectory
let fixtureExecutable

function fixtureGenerator() {
  if (fixtureExecutable) return fixtureExecutable
  if (process.platform !== 'darwin') throw new Error('Generated native image fixtures require macOS.')
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'agent-commons-image-ocr-fixture-'))
  const output = join(fixtureDirectory, 'png-fixture')
  const result = spawnSync('/usr/bin/clang', [
    '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-O2', SOURCE_PATH,
    '-framework', 'Foundation', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText',
    '-o', output,
  ], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/private/tmp' },
  })
  if (result.error) throw new Error('Could not compile the generated image fixture helper.', { cause: result.error })
  if (result.status !== 0) throw new Error(`Could not compile the generated image fixture helper${result.stderr ? `: ${result.stderr.trim()}` : '.'}`)
  chmodSync(output, 0o755)
  fixtureExecutable = output
  return output
}

/** Generate a test-owned PNG with visible CoreText glyphs, or a blank raster. */
export async function imageOcrFixture({ text = '', width = 1000, height = 240 } = {}) {
  if (typeof text !== 'string' || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || width > MAX_FIXTURE_EDGE || height < 1 || height > MAX_FIXTURE_EDGE) {
    throw new Error('Generated image fixture options are invalid.')
  }
  const result = spawnSync(fixtureGenerator(), [String(width), String(height), text], {
    encoding: 'buffer', timeout: 15_000, maxBuffer: FIXTURE_MAX_BUFFER,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/private/tmp' },
  })
  if (result.error) throw new Error('Could not generate an image fixture.', { cause: result.error })
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
    throw new Error('Could not generate an image fixture.')
  }
  return result.stdout
}

function cleanupFixtureGenerator() {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
  fixtureDirectory = undefined
  fixtureExecutable = undefined
}

process.once('exit', cleanupFixtureGenerator)
