/** A skipped case is not a complete verification run, even when Playwright
 * exits successfully and every case that actually ran passed. */
export default class RejectSkippedBrowserTests {
  onBegin(_config, suite) {
    this.suite = suite
  }

  async onEnd(result) {
    if (result.status !== 'passed') return
    const skipped = this.suite.allTests().filter(test => test.outcome() === 'skipped')
    if (skipped.length === 0) return

    for (const test of skipped) {
      process.stderr.write(`Browser test skipped during verification: ${test.titlePath().filter(Boolean).join(' › ')}\n`)
    }
    return { status: 'failed' }
  }
}
