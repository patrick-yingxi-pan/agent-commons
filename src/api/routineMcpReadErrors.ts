import { ApiRequestError } from './client.ts'

export type RoutineMcpReviewReadErrorKind = 'unavailable' | 'transient'

/** The owner-only route deliberately uses 404 for absence and foreign scope. */
export function routineMcpReviewReadErrorKind(error: unknown): RoutineMcpReviewReadErrorKind {
  return error instanceof ApiRequestError && [401, 403, 404].includes(error.status)
    ? 'unavailable'
    : 'transient'
}
