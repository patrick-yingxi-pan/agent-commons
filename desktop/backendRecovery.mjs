import { runNativeRecovery } from './nativeRecovery.mjs'

export const BACKEND_RECOVERY_DIALOG = Object.freeze({
  type: 'error',
  title: 'Restart Agent Commons?',
  message: 'The Agent Commons local service stopped unexpectedly.',
  detail: 'Work already saved remains on this device. Unsaved text in the window may be lost. Restart Agent Commons to recover, or quit.',
  buttons: ['Restart Agent Commons', 'Quit'],
  defaultId: 0,
  cancelId: 1,
  noLink: true,
})

/** A failed authoritative service gets a clean whole-app boundary rather than
 * reviving a renderer with an ambiguous cache or interrupted event stream. */
export function runBackendRecovery({ showMessageBox, restart, reportRestartFailure, quit }) {
  return runNativeRecovery({
    dialogOptions: BACKEND_RECOVERY_DIALOG,
    showMessageBox,
    recover: restart,
    reportFailure: reportRestartFailure,
    quit,
    recoveredStatus: 'restarting',
  })
}
