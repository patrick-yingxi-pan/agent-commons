/** Shared grant predicates for mediated invocation and served runner sources. */
import type { Runner, CapabilityRequest } from '../contract/index.ts'

/** Exact scope or slash-boundary descendant; only a literal `*` is a wildcard. */
export function scopeMatches(scope: string, target: string): boolean {
  if (scope === '*') return true
  if (scope === target) return true
  return target.startsWith(scope.endsWith('/') ? scope : `${scope}/`)
}

export function isGranted(runner: Runner, capability: CapabilityRequest['capability'], target: string): boolean {
  const cap = runner.capabilities.find((c) => c.type === capability)
  return !!cap && cap.scopes.some((scope) => scopeMatches(scope, target))
}
