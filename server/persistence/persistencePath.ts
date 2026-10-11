import { resolve } from 'node:path'

/** Resolve persistence paths without allowing a Node test process to fall back
 * to the mutable development store. Tests must opt into a temp file or memory. */
export function persistencePath(override: string | undefined, fallback: string, variable: string): string {
  if (process.env.NODE_TEST_CONTEXT !== undefined) {
    if (override === undefined) {
      throw new Error(`[persist] ${variable} must be set explicitly under node --test.`)
    }
    if (override !== ':memory:' && resolve(override) === resolve(fallback)) {
      throw new Error(`[persist] ${variable} cannot target the live default path under node --test.`)
    }
    return override
  }
  if (override !== undefined) return override
  return fallback
}
