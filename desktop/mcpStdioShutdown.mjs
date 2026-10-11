/** Give owned processes time to reach physical close before the main process
 * exits and loses its TERM/KILL timers. Timeout is not proof of cleanup. */
export async function waitForMcpStdioShutdown(shutdown, timeoutMs = 7_000) {
  if (typeof shutdown !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7_000) return false
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(shutdown).then(() => true, () => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}
