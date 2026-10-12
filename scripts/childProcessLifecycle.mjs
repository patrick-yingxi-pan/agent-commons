/** Ownership for repository-launched children, not arbitrary host processes.
 * POSIX groups are used only for children spawned with detached: true. Keep
 * pipes alive through graceful shutdown: 'exit' alone does not mean descendants
 * have released inherited output streams or listeners. */
export function observeChild(child, { processGroup = false } = {}) {
  let closed = false
  const ownsGroup = processGroup && process.platform !== 'win32'
  let groupGone = false
  const groupAlive = () => {
    if (!ownsGroup || !child.pid || groupGone) return false
    try { process.kill(-child.pid, 0); return true }
    catch (error) {
      if (error.code !== 'ESRCH') throw error
      // Once this owned group is gone, never target its numeric ID again.
      groupGone = true
      return false
    }
  }
  let resolveOutcome
  const outcome = new Promise(resolve => { resolveOutcome = resolve })
  child.once('close', (code, signal) => {
    closed = true
    resolveOutcome({ closed: true, code, signal })
  })
  return {
    child,
    outcome,
    get closed() { return closed },
    get stopped() { return closed && !groupAlive() },
    signal(signal) {
      if (!child.pid) return
      try {
        // A descendant may close its inherited pipes and survive its leader.
        // The leader's close event alone cannot retire a group we still own.
        if (ownsGroup) {
          if (groupAlive()) process.kill(-child.pid, signal)
        } else if (!closed) child.kill(signal)
      } catch (error) {
        // An exited child may not have delivered its close event yet.
        if (error.code !== 'ESRCH') throw error
      }
    },
    abandon() {
      // Failure is explicit, never a synthetic 'close' or successful cleanup.
      // Release local handles so an unconfirmed OS shutdown cannot hang the CLI.
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.unref()
      resolveOutcome({ closed: false, code: 1, signal: null })
    },
  }
}

async function stoppedWithin(children, timeoutMs, errors) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const stopped = children.every(child => {
      try { return child.stopped }
      catch (error) { errors.add(error.message); return false }
    })
    if (stopped) return true
    if (Date.now() >= deadline) return false
    // Group descendants do not emit events on their departed leader. Poll only
    // during this bounded shutdown; no detached background watcher is retained.
    await new Promise(resolve => setTimeout(resolve, Math.min(25, deadline - Date.now())))
  }
}

export async function stopOwnedChildren(children, {
  signal = 'SIGTERM', graceMs = 6_000, killWaitMs = 2_000,
} = {}) {
  const owned = [...children]
  const errors = new Set()
  const send = signal => {
    for (const child of owned) {
      try { child.signal(signal) }
      catch (error) { errors.add(error.message) }
    }
  }
  send(signal)
  if (await stoppedWithin(owned, graceMs, errors)) return { complete: true, errors: [...errors] }
  send('SIGKILL')
  const complete = await stoppedWithin(owned, killWaitMs, errors)
  if (!complete) for (const child of owned) if (!child.closed) child.abandon()
  return { complete, errors: [...errors] }
}
