import { runNativeRecovery } from './nativeRecovery.mjs'

export const RENDERER_RECOVERY_DIALOG = Object.freeze({
  type: 'error',
  title: 'Reopen Agent Commons?',
  message: 'The Agent Commons window stopped unexpectedly.',
  detail: 'Work already saved remains on this device. Unsaved text in the window may be lost. Reopen the window to continue, or quit Agent Commons.',
  buttons: ['Reopen window', 'Quit'],
  defaultId: 0,
  cancelId: 1,
  noLink: true,
})

/** Recover only the failed renderer. The caller keeps ownership of the healthy
 * backend and supplies one already-validated route to reopen. If Chromium
 * cannot reopen, an orderly app quit is safer than leaving a dead window. */
export async function runRendererRecovery({ showMessageBox, reopen, reportReopenFailure, quit }) {
  return runNativeRecovery({
    dialogOptions: RENDERER_RECOVERY_DIALOG,
    showMessageBox,
    recover: reopen,
    reportFailure: reportReopenFailure,
    quit,
    recoveredStatus: 'reopened',
  })
}
