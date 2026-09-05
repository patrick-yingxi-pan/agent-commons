/** Transport and exact authoritative reconciliation for organization founding. */
import type { MyOrg, Tenant } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { orgCreationId } from './orgCreationIdentity.ts'
import type { OrgCreationIntent } from './orgCreationRevision.ts'

function sameOrganization(left: Tenant, right: Tenant): boolean {
  return left.id === right.id && left.name === right.name && left.kind === 'org' && right.kind === 'org'
}

/** Merge only the proven founder seat; a delayed acknowledgement cannot replace
 * an independently accepted membership or a newer full registry read. */
export function rememberCreatedOrg(tenant: Tenant): void {
  const row: MyOrg = { tenant, role: 'owner' }
  if (peek<MyOrg[]>(keys.meOrgs)) {
    mutate<MyOrg[]>(keys.meOrgs, (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.tenant.id === tenant.id)
        ? rows.map((candidate) => candidate.tenant.id === tenant.id ? row : candidate)
        : [...rows, row]
    })
  }
  invalidate(keys.meOrgs)
}

export async function applyOrgCreation(
  intent: OrgCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await orgCreationId(intent.tenantId, idempotencyKey)
  const tenant = await apiPost<Tenant>(paths.orgs, intent.request, { idempotencyKey })
  const expected: Tenant = { id: expectedId, name: intent.request.name, kind: 'org' }
  if (!sameOrganization(tenant, expected)) {
    throw new Error('The server acknowledged a different organization than this request.')
  }
  rememberCreatedOrg(tenant)
}

/** Prove only the founder-owner seat derived from this account and logical
 * submission. A similar name can never settle the held form. */
export async function reconcileOrgCreation(
  intent: OrgCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await orgCreationId(intent.tenantId, idempotencyKey)
  const incoming = await apiGet<MyOrg[]>(paths.meOrgs)
  const represented = incoming.find((candidate) =>
    candidate.tenant.id === expectedId &&
    candidate.tenant.name === intent.request.name &&
    candidate.tenant.kind === 'org' &&
    candidate.role === 'owner'
  )
  const current = peek<MyOrg[]>(keys.meOrgs)
  if (!current) setData(keys.meOrgs, incoming)
  if (!represented) return false
  rememberCreatedOrg(represented.tenant)
  return true
}
