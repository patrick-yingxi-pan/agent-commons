import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { routineMcpLocalRestorePatches } from './routineMcpLocalRestoreFixture.mjs'
import { confirmManagedRestore } from './restoreProtocol.mjs'

const source = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')

test('local restore fixture emits at most three unique exact disposable-ASAR patches', () => {
  const patches = routineMcpLocalRestorePatches({ controlPath: '/tmp/routine-control.json', tracePath: '/tmp/routine-trace.jsonl' })
  assert.equal(patches.length, 3)
  assert.ok(patches.every(patch => patch.path === 'desktop/main.mjs'))
  for (const patch of patches) assert.equal(source.split(patch.before).length - 1, 1, 'each native restore patch target is unique')
  const transformed = patches.reduce((text, patch) => text.replace(patch.before, patch.after), source)
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: transformed, encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'the disposable main remains valid JavaScript')
})

test('fixture paths must be absolute and cannot inject multiline source', () => {
  for (const paths of [
    {},
    { controlPath: 'relative.json', tracePath: '/tmp/trace.jsonl' },
    { controlPath: '/tmp/control.json', tracePath: 'relative.jsonl' },
    { controlPath: '/tmp/control.json\nthrow 1', tracePath: '/tmp/trace.jsonl' },
    { controlPath: '/tmp/control\0.json', tracePath: '/tmp/trace.jsonl' },
  ]) assert.throws(() => routineMcpLocalRestorePatches(paths as never), /absolute single-line path/)
  assert.throws(() => routineMcpLocalRestorePatches({ controlPath: '/tmp/same', tracePath: '/tmp/same' }), /must be distinct/)
})

test('a trace write failure cannot suppress the real app exit', () => {
  const exitPatch = routineMcpLocalRestorePatches({ controlPath: '/tmp/control.json', tracePath: '/tmp/trace.jsonl' })[2]
  let exitCode: number | undefined
  assert.doesNotThrow(() => vm.runInNewContext(`
    const exitCode = 0
    const lifecycle = ({ ${exitPatch.after} })
    lifecycle.exit(7)
  `, {
    app: { exit: (code: number) => { exitCode = code } },
    routineMcpLocalRestoreTrace: () => { throw new Error('trace disk full') },
  }))
  assert.equal(exitCode, 7)
})

test('fixture approval requires the complete production restore confirmation detail', async () => {
  const confirmationPatch = routineMcpLocalRestorePatches({ controlPath: '/tmp/control.json', tracePath: '/tmp/trace.jsonl' })[1]
  const filename = 'backup-2026-10-12T23-03-39-949Z-2360947cd0703ded.json'
  const invoke = async (mutate: (options: Record<string, any>) => Record<string, any> = options => options) => {
    const wrappedConfirm = (input: Parameters<typeof confirmManagedRestore>[0]) => confirmManagedRestore({
      ...input,
      showMessageBox: (owner, options) => input.showMessageBox(owner, mutate(options)),
    })
    return vm.runInNewContext(`(async () => {
      ${confirmationPatch.after}
      return confirmed
    })()`, {
      pickManagedBackup: async () => ({ status: 'selected', fileName: filename }),
      confirmManagedRestore: wrappedConfirm,
      app: { getPath: () => '/tmp/profile' },
      mainWindow: null,
      startup: false,
      routineMcpLocalRestoreTrace() {},
    }) as Promise<boolean>
  }

  assert.equal(await invoke(), true, 'unchanged production confirmation options are accepted')
  for (const [label, replace] of [
    ['replacement disclosure', (detail: string) => detail.replace('replace local app data', 'keep local app data')],
    ['restart disclosure', (detail: string) => detail.replace('and restart', 'and continue')],
    ['credential disclosure', (detail: string) => detail.replace('Provider API keys remain in OS-encrypted storage.', 'Provider keys are protected.')],
  ] as const) {
    await assert.rejects(invoke(options => ({ ...options, detail: replace(options.detail) })),
      /Unexpected managed restore confirmation options/, `${label} changes fail closed`)
  }
})

test('fixture controls only native restore answers and relaunch while retaining the real lifecycle', () => {
  const patches = routineMcpLocalRestorePatches({ controlPath: '/tmp/control.json', tracePath: '/tmp/trace.jsonl' })
  const pickerAndConsent = patches[1].after
  const restart = patches[2].after
  assert.match(pickerAndConsent, /Restore Agent Commons from backup/)
  assert.match(pickerAndConsent, /JSON\.parse\(await fs\.readFile\(/)
  assert.match(pickerAndConsent, /control\.selectedPath/)
  assert.match(pickerAndConsent, /Restore Agent Commons\?'/)
  assert.match(pickerAndConsent, /options\?\.defaultId !== 0 \|\| options\?\.cancelId !== 0/)
  assert.match(pickerAndConsent, /response: 1/)
  assert.match(restart, /routineMcpLocalRestoreTrace\('relaunch'\)/)
  assert.match(restart, /routineMcpLocalRestoreTrace\('exit', \{ exitCode: code \}\)/)
  assert.match(restart, /app\.exit\(code\)/)
  for (const invariant of ['runManagedRestoreLifecycle({', 'createSafetyBackup: async () =>', 'stopBackend: async () =>',
    'await runRestoreWorker(selection.snapshotName)', 'reportShutdownFailure:', 'restart: relaunchDesktop']) {
    assert.ok(source.includes(invariant), `real restore lifecycle retains ${invariant}`)
  }
  assert.equal(patches.some(patch => patch.after.includes('runManagedRestoreLifecycle')), false,
    'fixture patches do not replace the lifecycle')
})
