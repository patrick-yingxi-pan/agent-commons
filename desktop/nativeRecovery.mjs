/**
 * One native recovery ceremony for a failed desktop boundary. Domain wrappers
 * own the copy and operation; this helper owns the safety posture: the first
 * button recovers, every other response quits, and a failed recovery is
 * reported before an orderly quit even when reporting itself fails.
 */
export async function runNativeRecovery({
  dialogOptions,
  showMessageBox,
  recover,
  reportFailure,
  quit,
  recoveredStatus,
}) {
  if (!dialogOptions || typeof dialogOptions !== 'object') throw new Error('Native recovery dialog options are required.')
  if (typeof showMessageBox !== 'function') throw new Error('A native recovery dialog is required.')
  if (typeof recover !== 'function') throw new Error('A native recovery operation is required.')
  if (typeof reportFailure !== 'function') throw new Error('A native recovery failure reporter is required.')
  if (typeof quit !== 'function') throw new Error('An orderly app quit operation is required.')
  if (typeof recoveredStatus !== 'string' || !recoveredStatus) throw new Error('A native recovery status is required.')

  const { response } = await showMessageBox(dialogOptions)
  if (response !== 0) {
    quit()
    return { status: 'quitting' }
  }
  try {
    await recover()
    return { status: recoveredStatus }
  } catch (error) {
    try {
      await reportFailure(error)
    } finally {
      quit()
    }
    return { status: 'quitting' }
  }
}
