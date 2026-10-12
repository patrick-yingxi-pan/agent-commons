import { ApiRequestError } from './client.ts'

export type CommissionMcpReviewReadErrorKind = 'unavailable' | 'transient'

/** Owner/person privacy makes both absence and foreign scope look unavailable. */
export function commissionMcpReviewReadErrorKind(error: unknown): CommissionMcpReviewReadErrorKind {
  return error instanceof ApiRequestError && [401, 403, 404].includes(error.status) ? 'unavailable' : 'transient'
}
