import { checkUpdateMetadata } from './updateMetadata.mjs'
import { downloadUpdateArchive } from './updateArchive.mjs'

/** Native-host owner of update intent. Checking never stages a native update;
 * a downloaded ZIP is inert until a separate install/restart confirmation. */
export function createDesktopUpdateController({
  configuration,
  check = checkUpdateMetadata,
  download = downloadUpdateArchive,
  confirmDownload,
  confirmInstall,
  install,
  inform,
  onState = () => {},
  onError = () => {},
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}) {
  const abort = new AbortController()
  let closed = false
  let started = false
  let timer = null
  let pending = null
  let disposal = null
  let update = null
  let archive = null
  let lastOffered = null
  let failureVisible = false
  let state = Object.freeze({ phase: configuration ? 'idle' : 'unconfigured', version: null })

  function publish(phase) {
    if (closed) return
    state = Object.freeze({ phase, version: update?.version ?? null })
    onState(state)
  }

  function run(operation, interactive = false) {
    if (closed) return Promise.resolve()
    if (pending) {
      failureVisible ||= interactive
      return pending
    }
    failureVisible = interactive
    const task = Promise.resolve().then(operation).catch(async (error) => {
      if (closed) return
      onError(error)
      publish(archive ? 'ready' : update ? 'available' : 'error')
      if (failureVisible) {
        try { await inform('error', abort.signal) }
        catch (dialogError) { if (!closed) onError(dialogError) }
      }
    }).finally(() => {
      if (pending === task) pending = null
    })
    pending = task
    return task
  }

  async function offerInstall() {
    if (!archive || closed) return
    const confirmed = await confirmInstall(update, abort.signal)
    if (!confirmed || closed) return
    publish('installing')
    await install({ update, archive })
  }

  async function offerDownload() {
    if (!update || closed) return
    const confirmed = await confirmDownload(update, abort.signal)
    if (!confirmed || closed) return
    failureVisible = true
    publish('downloading')
    const downloaded = await download(update, { signal: abort.signal })
    if (closed) {
      await downloaded.dispose()
      return
    }
    archive = downloaded
    publish('ready')
    await offerInstall()
  }

  function checkForUpdates({ interactive = false } = {}) {
    return run(async () => {
      if (!configuration) {
        if (failureVisible) await inform('unconfigured', abort.signal)
        return
      }
      if (archive) {
        if (failureVisible) await offerInstall()
        return
      }
      publish('checking')
      const candidate = await check({ ...configuration, signal: abort.signal })
      if (closed) return
      update = candidate
      publish(candidate ? 'available' : 'current')
      if (!candidate) {
        if (failureVisible) await inform('current', abort.signal)
        return
      }
      if (failureVisible || lastOffered !== candidate.version) {
        lastOffered = candidate.version
        await offerDownload()
      }
    }, interactive)
  }

  function action() {
    if (archive) return run(offerInstall, true)
    if (update) return run(offerDownload, true)
    return checkForUpdates({ interactive: true })
  }

  function scheduleCheck(delay) {
    timer = schedule(() => {
      timer = null
      void checkForUpdates().finally(() => {
        if (!closed) scheduleCheck(6 * 60 * 60_000)
      })
    }, delay)
    timer?.unref?.()
  }

  return {
    get state() { return state },
    action,
    checkForUpdates,
    start() {
      if (closed || started || !configuration) return
      started = true
      scheduleCheck(30_000)
    },
    dispose() {
      if (disposal) return disposal
      closed = true
      abort.abort()
      if (timer !== null) cancelSchedule(timer)
      disposal = (async () => {
        try { await pending }
        finally {
          if (archive) await archive.dispose()
          archive = null
        }
      })()
      return disposal
    },
  }
}

export function desktopUpdateMenuLabel(state) {
  if (state.phase === 'checking') return 'Checking for Updates…'
  if (state.phase === 'downloading') return 'Downloading Update…'
  if (state.phase === 'installing') return 'Installing Update…'
  if (state.phase === 'ready') return `Install ${state.version} and Restart…`
  if (state.phase === 'available') return `Download Update ${state.version}…`
  return 'Check for Updates…'
}
