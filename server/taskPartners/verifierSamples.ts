import type { PartnerRule } from '../../contract/taskPartners.ts'
import { fail } from './protocol.ts'

export interface VerifierSample { mediaType:string; base64:string; verdict:'passed' | 'rejected' }
export type VerifierSamples = (rule:PartnerRule)=>VerifierSample[]
const unavailable=():never=>fail(503,'conformance_unconfigured','The site operator must configure positive and negative samples for this exact verifier program.')

/** An operator can independently provision examples for approved checker
 * programs. The applicant cannot supply expected results when registering. */
export const deploymentVerifierSamples:VerifierSamples = rule=>{
  const encoded=process.env.TASK_PARTNER_VERIFIER_FIXTURES
  if (!encoded || encoded.length>1024*1024) return unavailable()
  let raw:unknown
  try { raw=JSON.parse(encoded) } catch { return unavailable() }
  if (!Array.isArray(raw) || raw.length>100) return unavailable()
  const matching=raw.filter(r=>r?.rule?.ruleId===rule.ruleId && r.rule.version===rule.version && r.rule.digest===rule.digest)
  if (matching.length !== 1) return unavailable()
  return matching[0].samples
}
export function samplesFor(rule:PartnerRule, lookup:VerifierSamples):VerifierSample[] {
  const rows=lookup(rule)
  if (!Array.isArray(rows) || rows.length<2 || rows.length>16) return unavailable()
  for (const row of rows) {
    if (!row || !['text/plain','application/json','application/octet-stream'].includes(row.mediaType) ||
        !['passed','rejected'].includes(row.verdict) || typeof row.base64!=='string' || row.base64.length>32768 ||
        Buffer.from(row.base64,'base64').toString('base64')!==row.base64) return unavailable()
  }
  if (!rows.some(r=>r.verdict==='passed') || !rows.some(r=>r.verdict==='rejected') ||
      new Set(rows.map(r=>r.mediaType+' '+r.base64)).size!==rows.length) return unavailable()
  return rows
}
