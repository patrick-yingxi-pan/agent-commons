import type { PartnerIdentity, PartnerRule } from './taskPartners.ts'

export const SITE_CUSTODIAN_ID = 'agent-commons'
export const SITE_WORK_CREDIT = { assetId: 'commons.work-credit', unit: 'credit' } as const
export interface WorkCreditBalance {
  assetId: string
  unit: string
  available: string
  held: string
}
export interface FrozenTaskPartner {
  partnerId: string
  displayName: string
  domainAscii: string
  identityRevision: number
  profilePath: string
  status: 'active' | 'verification_lapsed' | 'suspended' | 'revoked' | 'unavailable'
}
export interface TaskAsset {
  assetId: string
  unit: string
  quantity: string
}
export interface TaskArtifact {
  artifactId: string
  digest: string
  mediaType: string
}
export type TaskAcceptance =
  | { kind: 'sha256-prefix'; prefix: string; difficultyBits: number }
  | { kind: 'partner'; partnerId: string; rule: PartnerRule }
export interface TaskProvenance {
  partnerId: string
  model: string
  effort?: string
  maxInputTokens: number
  maxOutputTokens: number
}
export interface PartnerTaskTerms {
  description: string
  acceptance?: TaskAcceptance
  provenance?: TaskProvenance
  reward?: { partnerId: string; asset: TaskAsset; holdUntil: string }
  deadline?: string
  participation?: 'first-valid' | 'single-claim'
}
export interface PartnerSubmission {
  submissionId: string
  submittedAt: string
  mine: boolean
  text?: string
  digest?: string
  verdict: 'open' | 'pending' | 'passed' | 'rejected' | 'unavailable'
  provenance: 'optional' | 'pending' | 'attested' | 'failed'
}
export interface PartnerTaskView {
  taskId: string
  projectId: string
  termsVersion: number
  termsDigest: string
  terms: PartnerTaskTerms
  status: 'draft' | 'published' | 'closed' | 'cancelled'
  requester: boolean
  claim: 'available' | 'mine' | 'taken'
  funding:
    | 'volunteer'
    | 'awaiting'
    | 'reserving'
    | 'held'
    | 'delivering'
    | 'delivered'
    | 'returning'
    | 'returned'
    | 'uncertain'
  publishedAt?: string
  winnerId?: string
  previousOffer?: TaskVersion
  submissions: PartnerSubmission[]
  partners: FrozenTaskPartner[]
}
export type PartnerGrant =
  | { kind: 'reserve'; asset: TaskAsset; holdUntil: string }
  | { kind: 'receive'; asset: TaskAsset }
  | {
      kind: 'run'
      model: string
      effort?: string
      maxInputTokens: number
      maxOutputTokens: number
      inputDigest: string
    }
export interface TaskVersion {
  taskId: string
  termsVersion: number
  termsDigest: string
}
export interface TaskHandoff extends TaskVersion {
  handoffId: string
  partnerId: string
  environment: 'production'
  identity: PartnerIdentity
  handoffDomainAscii: string
  state: 'started' | 'exchanged' | 'attested' | 'confirmed' | 'declined' | 'expired' | 'withdrawn' | 'consumed'
  expiresAt: string
  grant: PartnerGrant
  accountLabel?: string
}
export type TaskAction =
  | { kind: 'reserve'; asset: TaskAsset; payerRef: string; grantRef: string; holdUntil: string }
  | {
      kind: 'run'
      input: TaskArtifact
      grantRef: string
      submissionId: string
      model: string
      effort?: string
      maxInputTokens: number
      maxOutputTokens: number
    }
  | { kind: 'verify'; submissionId: string; submission: TaskArtifact; rule: PartnerRule; inputs: TaskArtifact[] }
  | {
      kind: 'release'
      reservationId: string
      asset: TaskAsset
      beneficiaryRef: string
      grantRef: string
      submissionId: string
    }
  | { kind: 'return'; reservationId: string; asset: TaskAsset; payerRef: string }
export interface TaskPartnerCommand extends TaskVersion {
  commandId: string
  partnerId: string
  environment: 'production' | 'sandbox'
  issuedAt: string
  deadline: string
  state: 'requested' | 'uncertain' | 'succeeded' | 'failed'
  action: TaskAction
  receiptId?: string
}
