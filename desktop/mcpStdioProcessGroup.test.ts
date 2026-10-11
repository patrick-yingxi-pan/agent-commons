import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createMcpStdioSupervisor } from './mcpStdioSupervisor.mjs'

const launch = cwd => ({ executable: process.execPath, args: [], cwd, env: {} })
const within = (promise, milliseconds, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds) }),
  ]).finally(() => clearTimeout(timer))
}
const pidIsRunning = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error?.code !== 'ESRCH' }
}
async function waitForExit(pid, exitedPids, milliseconds = 1_500) {
  const deadline = Date.now() + milliseconds
  while (pidIsRunning(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(pidIsRunning(pid), false, `test-owned process ${pid} exited`)
  exitedPids.add(pid)
}
function cleanupPids(exitedPids, ...pids) {
  for (const pid of new Set(pids.filter(pid => Number.isSafeInteger(pid) && pid > 1))) {
    if (exitedPids.has(pid)) continue
    try { process.kill(pid, 'SIGKILL') } catch (error) { if (error?.code !== 'ESRCH') throw error }
  }
}
function readPids(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} }
}

test('Stop kills a Node fixture process group whose child and stdio-inheriting descendant ignore EOF and SIGTERM', {
  skip: process.platform !== 'darwin',
  timeout: 10_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-stdio-process-group-stop-'))
  const pidFile = join(directory, 'pids.json')
  const descendant = `
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      input += chunk;
      let newline;
      while ((newline = input.indexOf('\\n')) >= 0) {
        const line = input.slice(0, newline); input = input.slice(newline + 1);
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ready: true, pid: process.pid } }) + '\\n');
      }
    });
    process.stdin.resume();
  `
  const parent = `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });
    writeFileSync(process.argv[1], JSON.stringify({ parent: process.pid, descendant: child.pid }));
    child.on('exit', () => {});
  `
  const supervisor = createMcpStdioSupervisor()
  let connection
  let pids = {}
  const exitedPids = new Set()
  t.after(async () => {
    try { await within(connection?.close() ?? Promise.resolve(), 2_000, 'cleanup close') } catch { /* explicit PID cleanup below */ }
    pids = { ...pids, ...readPids(pidFile) }
    cleanupPids(exitedPids, pids.parent, pids.descendant)
    supervisor.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  connection = supervisor.open({ ...launch(directory), args: ['-e', parent, pidFile] }, { isCurrent: () => true })
  const ready = await within(connection.request('tools/list'), 5_000, 'descendant ready response')
  pids = readPids(pidFile)
  assert.equal(ready.result.ready, true)
  assert.equal(ready.result.pid, pids.descendant)
  assert.ok(pids.parent > 0 && pids.descendant > 0)
  assert.equal(new Set([pids.parent, pids.descendant]).size, 2)

  await within(connection.close(), 5_000, 'process-group close')
  await waitForExit(pids.parent, exitedPids)
  await waitForExit(pids.descendant, exitedPids)
})

test('direct parent exit still kills a stdio-inheriting descendant before closed resolves', {
  skip: process.platform !== 'darwin',
  timeout: 10_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-stdio-process-group-exit-'))
  const pidFile = join(directory, 'parent.json')
  const readyFile = join(directory, 'descendant-ready.json')
  const descendant = `
    const { writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
    writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid }));
    process.stdin.resume();
  `
  const parent = `
    const { spawn } = require('node:child_process');
    const { existsSync, readFileSync, writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => {});
    writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid }));
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, process.argv[2]], { stdio: 'inherit' });
    const publishAndExit = () => {
      if (!existsSync(process.argv[2])) { setTimeout(publishAndExit, 10); return; }
      const details = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      const response = { jsonrpc: '2.0', id: 1, result: { parent: process.pid, descendant: details.pid } };
      process.stdout.write(JSON.stringify(response) + '\\n', () => process.exit(0));
    };
    publishAndExit();
  `
  const supervisor = createMcpStdioSupervisor()
  let connection
  let pids = {}
  const exitedPids = new Set()
  t.after(async () => {
    try { await within(connection?.closed ?? Promise.resolve(), 2_000, 'cleanup closed') } catch { /* explicit PID cleanup below */ }
    const recorded = readPids(pidFile)
    pids.parent ??= recorded.parent ?? recorded.pid
    pids.descendant ??= readPids(readyFile).pid
    cleanupPids(exitedPids, pids.parent, pids.descendant)
    supervisor.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  connection = supervisor.open({ ...launch(directory), args: ['-e', parent, pidFile, readyFile] }, { isCurrent: () => true })
  const response = await within(connection.request('tools/list'), 5_000, 'parent response')
  pids = { parent: response.result.parent, descendant: response.result.descendant }
  assert.ok(pids.parent > 0 && pids.descendant > 0)
  assert.notEqual(pids.parent, pids.descendant)
  assert.equal(new Set([pids.parent, pids.descendant]).size, 2)

  await within(connection.closed, 5_000, 'closed after parent exit')
  await waitForExit(pids.parent, exitedPids)
  await waitForExit(pids.descendant, exitedPids)
})

test('direct parent exit kills a keepalive descendant with ignored stdio before close can observe it', {
  skip: process.platform !== 'darwin',
  timeout: 10_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-stdio-process-group-ignored-'))
  const pidFile = join(directory, 'parent.json')
  const readyFile = join(directory, 'descendant-ready.json')
  const descendant = `
    const { writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
    writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid }));
  `
  const parent = `
    const { spawn } = require('node:child_process');
    const { existsSync, readFileSync, writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
    writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid }));
    spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, process.argv[2]], { stdio: 'ignore' });
    const publishAndExit = () => {
      if (!existsSync(process.argv[2])) { setTimeout(publishAndExit, 10); return; }
      const details = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      const response = { jsonrpc: '2.0', id: 1, result: { parent: process.pid, descendant: details.pid } };
      process.stdout.write(JSON.stringify(response) + '\\n', () => process.exit(0));
    };
    publishAndExit();
  `
  const supervisor = createMcpStdioSupervisor()
  let connection
  let pids = {}
  const exitedPids = new Set()
  t.after(async () => {
    try { await within(connection?.closed ?? Promise.resolve(), 2_000, 'cleanup closed') } catch { /* explicit PID cleanup below */ }
    const recorded = readPids(pidFile)
    pids.parent ??= recorded.parent ?? recorded.pid
    pids.descendant ??= readPids(readyFile).pid
    cleanupPids(exitedPids, pids.parent, pids.descendant)
    supervisor.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  connection = supervisor.open({ ...launch(directory), args: ['-e', parent, pidFile, readyFile] }, { isCurrent: () => true })
  const response = await within(connection.request('tools/list'), 5_000, 'parent response')
  pids = { parent: response.result.parent, descendant: response.result.descendant }
  assert.ok(pids.parent > 0 && pids.descendant > 0)
  assert.equal(new Set([pids.parent, pids.descendant]).size, 2)

  await within(connection.closed, 5_000, 'closed after parent exit with ignored stdio')
  await waitForExit(pids.parent, exitedPids)
  await waitForExit(pids.descendant, exitedPids)
})
