/** Public and private projections of the task-partner protocol. Personal contact,
 * signing material and proof instructions are private application fields. */
export const partnerCapabilities = ['model-provider', 'custodian', 'verifier'] as const
export type PartnerCapability = typeof partnerCapabilities[number]
export type PartnerEnvironment = 'sandbox' | 'production'
export type PartnerDomainPurpose = 'website' | 'handoff'
export interface PartnerRule { ruleId: string; version: number; digest: string }
export interface PartnerCatalog {
  models: { model: string; efforts: string[] }[]
  assets: { assetId: string; unit: string }[]
  rules: PartnerRule[]
}
export interface PartnerPublicKey { kid: string; kty: 'OKP'; crv: 'Ed25519'; x: string }
export interface PartnerApplicationRequest {
  displayName: string
  organization: string
  organizationUrl: string
  contact: string
  recoveryContact: string
  handoffUrl: string
  capabilities: PartnerCapability[]
  catalog: PartnerCatalog
  publicKey: PartnerPublicKey
  sandboxReportId?: string
}
export interface PartnerKeyChallenge {
  applicationId: string; kid: string; nonce: string; audience: string; expiresAt: string
}
export interface PartnerSigningKey {
  kid: string; thumbprint: string; state: 'candidate' | 'active' | 'retiring' | 'revoked'
  validFrom: string; validUntil?: string
}
export interface PartnerDomainChallenge {
  challengeId: string; applicationId: string; environment: PartnerEnvironment
  purpose: PartnerDomainPurpose; domainAscii: string; recordName: string; recordValue: string
  expiresAt: string; state: 'pending' | 'verified' | 'expired' | 'conflict' | 'superseded'
}
export interface PartnerApplication extends Omit<PartnerApplicationRequest, 'publicKey' | 'capabilities' | 'sandboxReportId'> {
  applicationId: string; partnerId: string; environment: PartnerEnvironment; revision: number
  state: 'awaiting_proof' | 'sandbox_testing' | 'in_review' | 'active' | 'suspended' | 'revoked' | 'rejected'
  requestedCapabilities: PartnerCapability[]; acceptedCapabilities: PartnerCapability[]
  keys: PartnerSigningKey[]; domainChallengeIds: Partial<Record<PartnerDomainPurpose, string>>
  challenge?: PartnerKeyChallenge; conformanceReportId?: string; decisionReason?: string
  viewer?: { canManage: boolean; canReview: boolean }
}
export interface PartnerConformanceRun {
  reportId: string; applicationId: string; state: 'queued' | 'running' | 'passed' | 'failed'
  checks: { name: string; status: 'pending' | 'passed' | 'failed'; detail?: string }[]
  catalogDigest: string; suiteVersion: string
}
export type PartnerCollisionSignal = 'exact_name' | 'normalized_name' | 'confusable_name' | 'similar_name' | 'confusable_domain'
export interface PartnerIdentity {
  domainAscii: string; identityRevision: number; profilePath: string; verifiedAt: string; validUntil: string
  collisionSignals: PartnerCollisionSignal[]; relatedPartners: string[]
}
export interface PartnerPublicProfile {
  partnerId: string; displayName: string; identity: PartnerIdentity
  status: 'active' | 'verification_lapsed' | 'suspended' | 'revoked'
  capabilities: PartnerCapability[]; asOf: string
}
export interface PartnerCatalogEntry {
  trustedForActor?: boolean
  partnerId: string; displayName: string; environment: PartnerEnvironment; identity: PartnerIdentity
  capabilities: PartnerCapability[]; catalogRevision: number; catalog: PartnerCatalog
}
export interface PartnerAuditEntry {
  eventId: string; recordedAt: string; actorRef: string; action: string; revision: number
  reason?: string; reference?: string
}
