import childProcess from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

function assertArchitecture(architecture) {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error('Native macOS release host architecture must be arm64 or x64.')
  }
}

export function validateNativeMacReleaseHost(host, architecture) {
  assertArchitecture(architecture)
  const expected = { platform: 'darwin', architecture, translated: false }
  if (!isDeepStrictEqual(host, expected)) {
    throw new Error('Release requires matching native macOS host evidence; translated or unknown execution is not accepted.')
  }
  return Object.freeze(expected)
}

export function parseNativeMacReleaseHost(stdout, architecture) {
  assertArchitecture(architecture)
  let result
  try {
    if (typeof stdout !== 'string' || stdout.length > 256) throw new Error('Invalid probe output size.')
    result = JSON.parse(stdout)
  } catch (cause) {
    throw new Error('Native macOS release host inspection returned malformed output.', { cause })
  }
  if (!isDeepStrictEqual(result, { architecture, translation: result?.translation })) {
    throw new Error('Native macOS release host inspection returned mismatched evidence.')
  }
  if (result.translation === 1) {
    throw new Error('Direct release refuses Rosetta translation. Run arm64 on Apple Silicon or x64 on a native Intel Mac.')
  }
  if (result.translation !== 0 && !(architecture === 'x64' && result.translation === 'absent')) {
    throw new Error('Native macOS release host inspection could not establish native execution.')
  }
  return validateNativeMacReleaseHost({ platform: 'darwin', architecture, translated: false }, architecture)
}

export function nativeMacReleaseHostCommands({ platform, architecture, outputPath }) {
  if (platform !== 'darwin') throw new Error('Direct signed/notarized releases must run on macOS.')
  assertArchitecture(architecture)
  const machineArchitecture = architecture === 'x64' ? 'x86_64' : 'arm64'
  return [
    {
      command: '/usr/bin/clang',
      args: [
        '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=13.0',
        '-arch', machineArchitecture, fileURLToPath(new URL('./native/release-host.c', import.meta.url)),
        '-o', outputPath,
      ],
      timeout: 30_000,
    },
    // A universal system command may run arm64 even when Node is translated.
    // Force the probe to use the release process's exact architecture instead.
    { command: '/usr/bin/arch', args: [`-${machineArchitecture}`, outputPath], timeout: 5_000 },
  ]
}

export async function inspectNativeMacReleaseHost() {
  const architecture = process.arch
  // Refuse unsupported hosts before creating even a temporary build directory.
  nativeMacReleaseHostCommands({ platform: process.platform, architecture, outputPath: '' })
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'agent-commons-release-host-'))
  try {
    let stdout
    for (const { command, args, timeout } of nativeMacReleaseHostCommands({
      platform: process.platform, architecture, outputPath: join(directory, 'release-host'),
    })) {
      const result = childProcess.spawnSync(command, args, {
        cwd: directory,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: directory },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024,
      })
      if (result.error || result.status !== 0 || result.signal || result.stderr) {
        throw new Error(`Native macOS release host inspection failed at ${command}; no release was built.`, {
          cause: result.error ?? new Error(`status=${result.status}, signal=${result.signal}; ${result.stderr ?? ''}`),
        })
      }
      stdout = result.stdout
    }
    return parseNativeMacReleaseHost(stdout, architecture)
  } finally {
    await rm(directory, { recursive: true, force: false })
  }
}
