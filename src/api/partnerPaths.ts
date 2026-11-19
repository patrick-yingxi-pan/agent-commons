/** Loaded with the partner screens and enumerated alongside the main routes by access parity. */
export const partnerPaths = {
  partnerContinue: (id: string) => '/auth/task-partner-handoffs/' + encodeURIComponent(id),
  partnerRevision: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/revisions`,
  partnerRename: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/name`,
  partnerOutput: (project: string, work: string, submission: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/submissions/${encodeURIComponent(submission)}/output`,
  partnerBalance: '/task-partners/balance',
  partnerCreditGrants: '/task-partners/credit-grants',
  partnerFund: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/fund`,
  partnerApplications: (env: string) => `/task-partners/${encodeURIComponent(env)}/applications`,
  partnerApplication: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}`,
  partnerApplicationAudit: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/history`,
  partnerDomains: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/domain-challenges`,
  partnerDomain: (env: string, id: string, challenge: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/domain-challenges/${encodeURIComponent(challenge)}`,
  partnerSigningKeys: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/keys`,
  partnerProof: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/proofs`,
  partnerSuite: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/conformance`,
  partnerReport: (env: string, id: string, report: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/conformance/${encodeURIComponent(report)}`,
  partnerDecision: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/applications/${encodeURIComponent(id)}/decisions`,
  partnerCatalog: (env: string) => `/task-partners/${encodeURIComponent(env)}/catalog`,
  partnerHandoffs: (env: string) => `/task-partners/${encodeURIComponent(env)}/handoffs`,
  partnerHandoff: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/handoffs/${encodeURIComponent(id)}`,
  partnerHandoffDecision: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/handoffs/${encodeURIComponent(id)}/decisions`,
  partnerObligations: (env: string) => `/task-partners/${encodeURIComponent(env)}/obligations`,
  partnerRecoveries: (env: string, id: string) =>
    `/task-partners/${encodeURIComponent(env)}/obligations/${encodeURIComponent(id)}/recoveries`,
  partnerRecovery: (env: string, id: string, recovery: string) =>
    `/task-partners/${encodeURIComponent(env)}/obligations/${encodeURIComponent(id)}/recoveries/${encodeURIComponent(recovery)}`,
  partnerDrafts: (project: string) => `/projects/${encodeURIComponent(project)}/task-drafts`,
  partnerTaskTerms: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/terms`,
  partnerTaskPublish: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/publish`,
  partnerTaskClaim: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/claim`,
  partnerTaskSubmissions: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/submissions`,
  partnerTaskCancel: (project: string, work: string) =>
    `/projects/${encodeURIComponent(project)}/work/${encodeURIComponent(work)}/cancel`,
}
