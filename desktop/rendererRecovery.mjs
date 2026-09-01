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
  if (typeof showMessageBox !== 'function') throw new Error('A native renderer recovery dialog is required.')
  if (typeof reopen !== 'function') throw new Error('A renderer reopen operation is required.')
  if (typeof reportReopenFailure !== 'function') throw new Error('A renderer failure reporter is required.')
  if (typeof quit !== 'function') throw new Error('An orderly app quit operation is required.')

  const { response } = await showMessageBox(RENDERER_RECOVERY_DIALOG)
  if (response !== 0) {
    quit()
    return { status: 'quitting' }
  }
  try {
    await reopen()
    return { status: 'reopened' }
  } catch (error) {
    try {
      await reportReopenFailure(error)
    } finally {
      quit()
    }
    return { status: 'quitting' }
  }
}
