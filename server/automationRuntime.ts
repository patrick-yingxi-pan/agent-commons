/** Legacy collaboration simulations are development fixtures, never execution
 * adapters. A configured model or MCP connection does not implement Dispatch,
 * commissioned Project effects, or an Agent proxy. Real Routines and explicit
 * Contribution MCP calls have their own independently authorized paths. */
export function automationRuntimeMode(
  env: Record<string, string | undefined> = process.env,
): 'fixture' | 'unconfigured' {
  return env.DEPLOYMENT_PROFILE ? 'unconfigured' : 'fixture'
}

export const AUTOMATION_RUNTIME_UNAVAILABLE = {
  dispatch: 'Dispatch execution is not available in this release. No Agent was run. Start a conversation or use a configured Routine instead.',
  'project-effect': 'Commissioned Project effect execution is not available in this release. No effect was performed or credited.',
  proxy: 'Agent proxy execution is not available in this release. No Agent acted on the target resource.',
} as const

export type AutomationFixtureKind = keyof typeof AUTOMATION_RUNTIME_UNAVAILABLE

export class AutomationUnavailableError extends Error {
  readonly code = 'capability_unavailable' as const
  constructor(kind: AutomationFixtureKind) {
    super(AUTOMATION_RUNTIME_UNAVAILABLE[kind])
    this.name = 'AutomationUnavailableError'
  }
}

export function requireAutomationFixture(kind: AutomationFixtureKind): void {
  if (automationRuntimeMode() !== 'fixture') throw new AutomationUnavailableError(kind)
}
