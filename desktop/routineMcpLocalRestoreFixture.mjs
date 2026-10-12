import { isAbsolute, resolve } from 'node:path'

const MAIN = 'desktop/main.mjs'

function exactPath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    throw new TypeError(`${label} must be an absolute single-line path`)
  }
  return value
}

/** Fixture-only answers for a disposable packaged ASAR. The app still selects
 * and validates the managed backup, runs the restore lifecycle and exits. */
export function routineMcpLocalRestorePatches({ controlPath, tracePath } = {}) {
  const control = exactPath(controlPath, 'controlPath')
  const trace = exactPath(tracePath, 'tracePath')
  if (resolve(control) === resolve(trace)) throw new TypeError('controlPath and tracePath must be distinct')
  const setup = `function routineMcpLocalRestoreTrace(event, details = {}) {
  routineMcpLocalRestoreAppend(${JSON.stringify(trace)}, JSON.stringify({ event, ...details }) + '\\n', { mode: 0o600 })
}
`
  const confirm = `showMessageBox: async (_owner, options) => {
        if (options?.type !== 'warning' || options?.title !== 'Restore Agent Commons?' ||
          !/^Restore “.+”\\?$/.test(options?.message ?? '') ||
          JSON.stringify(options?.buttons) !== JSON.stringify(['Cancel', 'Restore and restart']) ||
          options?.defaultId !== 0 || options?.cancelId !== 0 || options?.noLink !== true ||
          options?.detail !== 'Agent Commons will first save a fresh safety backup, then replace local app data and restart. Provider API keys remain in OS-encrypted storage.') {
          throw new Error('Unexpected managed restore confirmation options.')
        }
        routineMcpLocalRestoreTrace('confirmation', { options, response: 1 })
        return { response: 1 }
      }`
  const picker = `const selection = await pickManagedBackup({
      owner: mainWindow,
      userDataPath: app.getPath('userData'),
      showOpenDialog: async (_owner, options) => {
        if (options?.title !== 'Restore Agent Commons from backup' ||
          JSON.stringify(options?.properties) !== JSON.stringify(['openFile', 'dontAddToRecent']) ||
          options?.buttonLabel !== 'Choose backup' ||
          JSON.stringify(options?.filters) !== JSON.stringify([{ name: 'Agent Commons backups', extensions: ['json'] }])) {
          throw new Error('Unexpected managed restore picker options.')
        }
        const fs = await import('node:fs/promises')
        const control = JSON.parse(await fs.readFile(${JSON.stringify(control)}, 'utf8'))
        if (!control || Object.keys(control).length !== 1 || typeof control.selectedPath !== 'string' || !control.selectedPath) {
          throw new Error('Invalid managed restore fixture control.')
        }
        routineMcpLocalRestoreTrace('picker', { options, selectedPath: control.selectedPath })
        return { canceled: false, filePaths: [control.selectedPath] }
      },
    })
    if (selection.status === 'cancelled') return { status: 'cancelled' }
    const confirmed = await confirmManagedRestore({
      owner: mainWindow,
      fileName: selection.fileName,
      startup,
      ${confirm},
    })
    if (!confirmed) return { status: 'cancelled' }`
  return [
    { path: MAIN, before: `import { existsSync } from 'node:fs'`,
      after: `import { existsSync, appendFileSync as routineMcpLocalRestoreAppend } from 'node:fs'\n${setup}` },
    { path: MAIN, before: `const selection = await pickManagedBackup({
      owner: mainWindow,
      userDataPath: app.getPath('userData'),
      showOpenDialog: (owner, options) => owner
        ? dialog.showOpenDialog(owner, options)
        : dialog.showOpenDialog(options),
    })
    if (selection.status === 'cancelled') return { status: 'cancelled' }
    const confirmed = await confirmManagedRestore({
      owner: mainWindow,
      fileName: selection.fileName,
      startup,
      showMessageBox: (owner, options) => owner
        ? dialog.showMessageBox(owner, options)
        : dialog.showMessageBox(options),
    })
    if (!confirmed) return { status: 'cancelled' }`, after: picker },
    { path: MAIN, before: 'relaunch: () => app.relaunch(), exit: code => app.exit(code), exitCode,',
      after: `relaunch: () => { routineMcpLocalRestoreTrace('relaunch'); }, exit: code => {
      try { routineMcpLocalRestoreTrace('exit', { exitCode: code }) } catch {}
      finally { app.exit(code) }
    }, exitCode,` },
  ]
}
