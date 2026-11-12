import { execFile, spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, relative } from 'node:path'
import { ROOT } from './source.ts'

function npmSource(node) {
  return `#!${node}
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'

const state = process.env.VERIFY_FIXTURE_STATE
const args = process.argv.slice(2).join(' ')
appendFileSync(join(state, 'steps.log'), 'npm ' + args + '\\n')
if (args === 'run typecheck' && process.env.VERIFY_FIXTURE_HOLD === '1') {
  writeFileSync(join(state, 'npm.pid'), String(process.pid))
  const server = createServer(socket => {
    writeFileSync(join(state, 'accepted'), 'accepted')
    socket.on('error', () => {})
  })
  let draining = false
  const drain = signal => {
    if (draining) return
    draining = true
    writeFileSync(join(state, 'signal-' + signal), signal)
    appendFileSync(join(state, 'events.log'), 'signal:' + signal + '\\n')
    server.close(() => {
      writeFileSync(join(state, 'drained'), 'drained')
      process.exitCode = 0
    })
  }
  process.on('SIGINT', () => drain('SIGINT'))
  process.on('SIGTERM', () => drain('SIGTERM'))
  process.on('exit', () => writeFileSync(join(state, 'exited'), 'exited'))
  server.listen(0, '127.0.0.1', () => {
    writeFileSync(join(state, 'ready.json'), JSON.stringify({ pid: process.pid, port: server.address().port }))
  })
} else if (args === 'run build') {
  writeFileSync(join(state, 'build-started'), 'build')
}`
}

function npxSource(node) {
  return `#!${node}
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const state = process.env.VERIFY_FIXTURE_STATE
writeFileSync(join(state, 'npx-finished'), 'finished')
writeFileSync(join(state, 'npx-env-' + process.env.E2E_SHARD + '.json'), JSON.stringify({
  shard: process.env.E2E_SHARD, cacheDir: process.env.PWTEST_CACHE_DIR,
}))
process.stdout.write('› e2e/first.spec.ts:1:1 › first fixture (11ms)\\n')
process.stdout.write('› e2e/second.spec.ts:1:1 › second fixture (13ms)\\n')
process.stdout.write(process.env.VERIFY_FIXTURE_PASSED + ' passed\\n')`
}

function nodeSource(node) {
  return `#!${node}
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === '--test') {
  writeFileSync(join(process.env.VERIFY_FIXTURE_STATE, 'node-test-started'), 'node test')
}`
}

export async function createVerifyInterruptionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'verify-interruption-'))
  const scripts = join(root, 'scripts')
  const state = join(root, 'state')
  const bin = join(root, 'bin')
  await Promise.all([mkdir(scripts), mkdir(join(root, 'e2e')), mkdir(join(root, 'tests')), mkdir(state), mkdir(bin)])
  for (const name of ['verify.mjs', 'verifyPlan.mjs', 'hostSpeed.mjs', 'childProcessLifecycle.mjs']) {
    await copyFile(join(ROOT, 'scripts', name), join(scripts, name))
  }

  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: {
    test: 'node --test --test-concurrency=1 "tests/**/*.test.ts"',
  } }))
  await writeFile(join(root, 'e2e', 'first.spec.ts'), "test('first fixture', () => {})\n")
  await writeFile(join(root, 'e2e', 'second.spec.ts'), "test('second fixture', () => {})\n")
  await writeFile(join(root, 'tests', 'placeholder.test.ts'), "import { test } from 'node:test'\ntest('placeholder', () => {})\n")
  const launchers = [
    ['npm', npmSource(process.execPath)],
    ['npx', npxSource(process.execPath)],
    ['node', nodeSource(process.execPath)],
  ]
  for (const [name, source] of launchers) {
    const path = join(bin, name)
    if (process.platform === 'win32') {
      await writeFile(`${path}.mjs`, source)
      await writeFile(`${path}.cmd`, `@"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`)
    } else {
      await writeFile(path, source, { mode: 0o755 })
      await chmod(path, 0o755)
    }
  }
  return { root, state, bin, runner: join(scripts, 'verify.mjs') }
}

export async function waitForFixtureFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8') } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    // Poll for child-authored readiness instead of guessing a startup delay.
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for fixture readiness: ${basename(path)}`)
}

export function startFixtureVerifier(fixture, { holdTypecheck = false, reportedPasses = 2, runnerArgs = [], partition } = {}) {
  const env = { ...process.env }
  delete env.VERIFY_E2E_PART
  delete env.VERIFY_E2E_PARTS
  if (partition) {
    env.VERIFY_E2E_PART = String(partition.part)
    env.VERIFY_E2E_PARTS = String(partition.parts)
  }
  Object.assign(env, {
    PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ''}`,
    VERIFY_FIXTURE_STATE: fixture.state,
    VERIFY_FIXTURE_HOLD: holdTypecheck ? '1' : '0',
    VERIFY_FIXTURE_PASSED: String(reportedPasses),
    E2E_SHARDS: '1',
    // Synthetic lanes test lifecycle and coverage, not CPU calibration. Their
    // host profile must be deterministic even under the full verifier load.
    E2E_HOST_FACTOR: '1',
  })
  const child = spawn(process.execPath, [fixture.runner, ...runnerArgs], {
    cwd: fixture.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  return { child, closed, output: () => output }
}

function signalExact(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) return false
  try {
    process.kill(pid, signal)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function fixturePids(state) {
  // An exit marker retires this fixture identity; do not signal a recycled PID.
  try { await readFile(join(state, 'exited')); return [] }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const pids = new Set()
  for (const name of ['npm.pid', 'ready.json']) {
    try {
      const raw = await readFile(join(state, name), 'utf8')
      const pid = name === 'ready.json' ? JSON.parse(raw).pid : Number(raw)
      if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid) pids.add(pid)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return [...pids]
}

async function waitForPidsGone(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const live = pids.filter(pid => {
      try { process.kill(pid, 0); return true }
      catch (error) { if (error.code === 'ESRCH') return false; throw error }
    })
    if (live.length === 0) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const live = pids.filter(pid => {
    try { process.kill(pid, 0); return true }
    catch (error) { if (error.code === 'ESRCH') return false; throw error }
  })
  if (live.length) throw new Error(`Fixture-owned processes did not exit: ${live.join(', ')}`)
}

export async function removeVerifyInterruptionFixture(fixture, verifier, socket) {
  socket?.destroy()
  const pids = await fixturePids(fixture.state)
  try {
    if (verifier?.child.exitCode === null && verifier.child.signalCode === null) {
      if (process.platform === 'win32') {
        // Windows signals terminate only the leader. While this exact spawned
        // verifier still owns its PID, retire its cmd/shim descendants too.
        const child = verifier.child
        await new Promise((resolve, reject) => {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, error => {
            if (!error || child.exitCode !== null || child.signalCode !== null) resolve()
            else reject(error)
          })
        })
      } else verifier.child.kill('SIGINT')
    }
    // Cleanup must also work against the intentionally broken verifier, which
    // may already have exited without forwarding any signal to this fixture.
    for (const pid of pids) signalExact(pid, 'SIGTERM')
    try { await waitForPidsGone(pids, 2_000) }
    catch {
      for (const pid of await fixturePids(fixture.state)) signalExact(pid, 'SIGKILL')
      await waitForPidsGone(pids, 2_000)
    }
    const verifierClosed = verifier
      ? await closesWithin(verifier.closed, 5_000)
      : true
    if (!verifierClosed) {
      if (verifier?.child.exitCode === null && verifier.child.signalCode === null) verifier.child.kill('SIGKILL')
      if (!await closesWithin(verifier.closed, 3_000)) {
        throw new Error('Fixture verifier remained alive after bounded cleanup')
      }
    }
  } finally {
    await removeFixtureRoot(fixture.root)
  }
}

async function removeFixtureRoot(root) {
  let target
  try { target = await realpath(root) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  const tempRoot = await realpath(tmpdir())
  // Resolve the actual target before recursive removal; a replaced symlink or
  // malformed fixture object must never expand cleanup outside its temp root.
  if (relative(tempRoot, target) !== basename(target) || !basename(target).startsWith('verify-interruption-')) {
    throw new Error('Refusing to remove a verifier fixture outside its temporary root')
  }
  // Windows may briefly retain cwd/file handles after taskkill and pipe close.
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function closesWithin(closed, timeoutMs) {
  let timer
  try {
    return await Promise.race([closed.then(() => true), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}
