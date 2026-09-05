import type { CreateOrgRequest } from '../../contract/index.ts'

/** One submitted organization form owns one immutable name and retry identity. */
export interface OrgCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly request: CreateOrgRequest
}

export const orgCreationResourceId = (intent: OrgCreationIntent): string =>
  `org-create:${intent.intentId}`
