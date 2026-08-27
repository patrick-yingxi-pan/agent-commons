/** Truthful resolution for an addressed resource whose page is waiting on one
 * or more query-cache reads.
 *
 * A list-derived detail may claim "missing" only after every registry read has
 * succeeded. Pending or failed refreshes are not evidence that an id is gone.
 * A direct by-id read may additionally map an existence-hiding 404 to the same
 * missing face; every other failure stays retryable. Cache-retained resources
 * never enter this policy because their page resolves before the unavailable
 * branch is considered. */
import { invalidate, type QueryState } from './cache.ts'

export type ResourceUnavailableState = 'loading' | 'error' | 'missing'

type ResourceRead = Pick<QueryState<unknown>, 'status' | 'error'>

function hasHttpStatus(error: Error | undefined, status: number): boolean {
  return typeof (error as (Error & { status?: unknown }) | undefined)?.status === 'number' &&
    (error as Error & { status: number }).status === status
}

export function resolveResourceUnavailable(
  reads: readonly [ResourceRead, ...ResourceRead[]],
  options: { notFoundIsMissing?: boolean } = {},
): ResourceUnavailableState {
  const failed = reads.filter((read) => read.status === 'error')
  if (failed.length > 0) {
    const onlyExpectedNotFound =
      options.notFoundIsMissing === true &&
      reads.length === 1 &&
      failed.every((read) => hasHttpStatus(read.error, 404))
    return onlyExpectedNotFound ? 'missing' : 'error'
  }
  return reads.every((read) => read.status === 'success') ? 'missing' : 'loading'
}

/** Retry every read needed to decide one page. The caller wraps this in a
 * zero-argument callback, keeping React's click event outside the cache API. */
export function retryResourceQueries(queryKeys: readonly string[]): void {
  for (const key of new Set(queryKeys)) invalidate(key)
}
