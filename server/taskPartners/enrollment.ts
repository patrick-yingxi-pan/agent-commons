import { partnerCapabilities } from '../../contract/taskPartners.ts'
import type { PartnerApplicationRequest, PartnerCapability, PartnerCatalog } from '../../contract/taskPartners.ts'
import { fail, fields, label, positive, publicKey, tokenId } from './protocol.ts'
import { comparisonKeys, partnerWebsite } from './identity.ts'

export function capabilities(value: unknown): PartnerCapability[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 ||
      !value.every(role => partnerCapabilities.includes(role)) || new Set(value).size !== value.length)
    return fail(400, 'bad_request', 'Choose at least one supported capability.')
  if (value.includes('verifier') && !value.includes('custodian'))
    return fail(400, 'bad_request', 'An external verifier must also be an accepted custodian.')
  return [...value]
}
function list<T>(input: unknown, limit: number, parse: (item: unknown) => T, key: (item: T) => string): T[] {
  if (!Array.isArray(input) || input.length > limit) return fail(400, 'bad_request', 'The catalog list is invalid or too large.')
  const values = input.map(parse)
  if (new Set(values.map(key)).size !== values.length) return fail(400, 'bad_request', 'Remove duplicate catalog entries.')
  return values
}
function parseCatalog(raw: unknown, roles: PartnerCapability[]): PartnerCatalog {
  const obj = fields(raw, ['models', 'assets', 'rules'])
  const models = list(obj.models, 100, item => {
    const m = fields(item, ['model', 'efforts'])
    return { model: tokenId(m.model), efforts: list(m.efforts, 32, tokenId, s => s) }
  }, m => m.model)
  const assets = list(obj.assets, 100, item => {
    const a = fields(item, ['assetId', 'unit'])
    return { assetId: tokenId(a.assetId), unit: tokenId(a.unit) }
  }, a => JSON.stringify([a.assetId, a.unit]))
  const rules = list(obj.rules, 100, item => {
    const r = fields(item, ['ruleId', 'version', 'digest'])
    if (typeof r.digest !== 'string' || !/^[0-9a-f]{64}$/.test(r.digest)) return fail(400, 'bad_request', 'Supply an exact SHA-256 rule digest.')
    return { ruleId: tokenId(r.ruleId), version: positive(r.version), digest: r.digest }
  }, r => JSON.stringify([r.ruleId, r.version]))
  if (!!models.length !== roles.includes('model-provider') || !!assets.length !== roles.includes('custodian') ||
      !!rules.length !== roles.includes('verifier'))
    return fail(400, 'bad_request', 'Supply catalog entries for each requested role.')
  return { models, assets, rules }
}
export function partnerDisplayName(value:unknown) {
  const name=label(value,100,'display name')
  if (!/[\p{L}\p{N}\p{S}]/u.test(name) || /[\p{Cn}\p{Co}]/u.test(name) || !comparisonKeys(name,'').normalized)
    return fail(400, 'bad_request', 'Enter a recognizable organization name.')
  return name
}
export function enrollment(input: unknown): PartnerApplicationRequest {
  const row = fields(input, ['displayName', 'organization', 'organizationUrl', 'contact', 'recoveryContact',
    'handoffUrl', 'capabilities', 'catalog', 'publicKey'], ['sandboxReportId'])
  const contact = label(row.contact, 254, 'contact email')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return fail(400, 'bad_request', 'Enter a contact email address.')
  const roles = capabilities(row.capabilities)
  const displayName = partnerDisplayName(row.displayName)
  return { displayName, contact, organization: label(row.organization, 160, 'organization'),
    organizationUrl: partnerWebsite(row.organizationUrl, 'website').href,
    handoffUrl: partnerWebsite(row.handoffUrl, 'handoff').href,
    recoveryContact: label(row.recoveryContact, 200, 'recovery contact'), capabilities: roles,
    catalog: parseCatalog(row.catalog, roles), publicKey: publicKey(row.publicKey),
    ...(row.sandboxReportId === undefined ? {} : { sandboxReportId: tokenId(row.sandboxReportId) }) }
}
