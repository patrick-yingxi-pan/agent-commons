import { serveApprovedUpdate } from './updateArchive.mjs'

/** Only called for an already-downloaded, verified ZIP after install consent. */
export async function stageNativeUpdate({ updater, archivePath, update, serve = serveApprovedUpdate, timeoutMs = 120_000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Native update staging deadline is invalid.')
  const bridge = await serve({ archivePath, update })
  const failures = []
  try {
    await new Promise((resolve, reject) => {
      let timer
      const finish = (error) => {
        clearTimeout(timer)
        updater.removeListener('error', failed)
        updater.removeListener('update-downloaded', downloaded)
        updater.removeListener('update-not-available', unavailable)
        if (error) reject(error)
        else resolve()
      }
      const failed = (error) => finish(error)
      const downloaded = () => finish()
      const unavailable = () => finish(new Error('The approved update was not staged.'))
      updater.once('error', failed)
      updater.once('update-downloaded', downloaded)
      updater.once('update-not-available', unavailable)
      timer = setTimeout(() => finish(new Error('Preparing the approved update timed out.')), timeoutMs)
      try {
        // The loopback bridge serves only the pinned, verified local archive.
        // Native Squirrel remains responsible for Apple signature verification.
        updater.setFeedURL({ url: bridge.feedUrl, serverType: 'default' })
        updater.checkForUpdates()
      } catch (error) { finish(error) }
    })
  } catch (error) {
    failures.push(error)
  }
  try { await bridge.close() }
  catch (error) { throw new AggregateError([...failures, error], 'Native update staging bridge cleanup failed.') }
  if (failures.length) throw failures[0]
}

/** Preserve the restore lifecycle's safety-copy and strict-stop boundaries.
 * Once shutdown starts, failure recovers by restarting, never by resuming a
 * potentially half-stopped backend or silently retrying native installation. */
export async function runManagedUpdateLifecycle({
  createSafetyBackup,
  stopBackend,
  stageUpdate,
  discardDownload,
  installAndRestart,
  reportShutdownFailure,
  restart,
}) {
  const safetyBackup = await createSafetyBackup()
  try {
    await stopBackend()
    await stageUpdate()
    await discardDownload()
    await installAndRestart()
    return { status: 'restarting' }
  } catch (error) {
    try { await reportShutdownFailure({ error, safetyBackup }) }
    finally { await restart(1) }
    return { status: 'restarting' }
  }
}

/** app.exit bypasses before-quit; restore/recovery must drain update work first.
 * The installing lifecycle supplies its own cleanup to avoid awaiting itself. */
export async function relaunchAfterUpdateCleanup({ disposeUpdates, onCleanupError, relaunch, exit, exitCode = 0 }) {
  try { await disposeUpdates() }
  catch (error) { await onCleanupError(error) }
  relaunch()
  exit(exitCode)
}
