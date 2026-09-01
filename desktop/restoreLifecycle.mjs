/** Execute the destructive portion of a confirmed desktop restore.
 *
 * Selection and confirmation stay outside this state machine. A healthy app
 * must create a safety copy before shutdown. Once shutdown begins, every
 * outcome restarts the shell; the live backend is never resumed in-process
 * after a partial or failed restore attempt.
 */
export async function runManagedRestoreLifecycle({
  startup = false,
  createSafetyBackup,
  stopBackend,
  restoreSnapshot,
  reportShutdownFailure,
  restart,
}) {
  if (!startup && typeof createSafetyBackup !== 'function') throw new Error('A safety backup creator is required.')
  if (typeof stopBackend !== 'function') throw new Error('A backend stop operation is required.')
  if (typeof restoreSnapshot !== 'function') throw new Error('A restore operation is required.')
  if (typeof reportShutdownFailure !== 'function') throw new Error('A shutdown failure reporter is required.')
  if (typeof restart !== 'function') throw new Error('A desktop restart operation is required.')

  const safetyBackup = startup ? null : await createSafetyBackup()
  try {
    await stopBackend()
    await restoreSnapshot()
    restart(0)
    return { status: 'restarting' }
  } catch (error) {
    try {
      await reportShutdownFailure({ error, safetyBackup })
    } finally {
      restart(1)
    }
    return { status: 'restarting' }
  }
}
