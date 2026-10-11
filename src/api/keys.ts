/** Cache keys + API paths, defined once so a query and the event that invalidates
 *  it can't drift. `keys.*` index the client cache; `paths.*` are the URLs under
 *  `API_BASE`. Both grow per resource as reads migrate. */
import type { Connector, SearchPage } from '../../contract/index.ts'

/** One shared encoder keeps every declared path builder byte-equivalent. */
const encodePathSegment = encodeURIComponent

export const keys = {
  capabilities: 'capabilities',
  /** The current principal + tenant (design F2 / P1 §4 — "Identity from /v1/me"). */
  me: 'me',
  modelPreferences: (userId: string, tenantId: string) => `viewer-model-preferences:${JSON.stringify([tenantId, userId])}`,
  /** The accounts signed in on this browser (§12 — the switcher's instant hops). */
  authAccounts: 'auth-accounts',
  /** The caller's org seats + pending invitations (FWD-6 — orgs as namespaces). */
  meOrgs: 'me-orgs',
  meInvites: 'me-invites',
  /** The caller's coordination dashboard (COMMONS-25) — posted items + authored proposals. */
  myWork: 'my-work',
  orgMembers: (orgId: string) => `org-members:${orgId}`,
  orgInvites: (orgId: string) => `org-invites:${orgId}`,
  providers: 'providers',
  systemPrompts: 'system-prompts',
  /** The Agent tool catalog — the names an explicit tool grant can spell out (INV-9:
   *  an omitted grant is the empty set, so "all tools" must be stated, from a live read). */
  agentTools: 'agent-tools',
  /** Worker Agents (docs/agent-commons.md, D6). Distinct from `runners` below — whose
   *  cache key is the legacy string 'agents' from before the D6 rename. */
  workerAgents: 'worker-agents',
  /** Commissions, keyed per project so a Project's Contributor list caches on its own. */
  commissions: (projectId?: string) => (projectId ? `commissions:${projectId}` : 'commissions'),
  /** A commission's effective (Project-clamped) authority — the D12 reach. */
  commissionAuthority: (id: string) => `commission-authority:${id}`,
  /** A Project's in-flight sub-goal reservations (D11 coordination) — the no-arg
   *  call is the family prefix for `invalidatePrefix` (the directory-keys convention). */
  projectSubGoals: (projectId?: string) => (projectId ? `project-subgoals:${projectId}` : 'project-subgoals'),
  /** A Project's open-work backlog (docs/agent-commons.md, D19). */
  openSubGoals: (projectId: string) => `open-subgoals:${projectId}`,
  /** A Project's contribution ledger (agent-contribution workflow Phase A). */
  contributions: (projectId: string) => `contributions:${projectId}`,
  /** A Project's delegation roster (CW8, Phase F). */
  delegations: (projectId: string) => `delegations:${projectId}`,
  /** A resource's grant roster (social S1) — keyed per subject ref; no-arg =
   *  the family prefix (invalidated whole on `grant.changed`). */
  grants: (kind?: string, id?: string) => (kind && id ? `grants:${kind}:${id}` : 'grants'),
  /** A subject's discussions (social S2) — same shape; `discussion:` alone is
   *  the by-id family. */
  discussions: (kind?: string, id?: string) => (kind && id ? `discussions:${kind}:${id}` : 'discussions'),
  socialCapability: (kind: string, id: string) => `social-capability:${kind}:${id}`,
  discussion: (did?: string) => (did ? `discussion:${did}` : 'discussion'),
  myDiscussions: 'discussions:mine',
  /** The caller's DM inbox (S7) — principal-anchored threads. A key of its own
   *  rather than a filter over `myDiscussions`, because the server lists a DM in
   *  exactly one of the two and the unread mark rides this projection. */
  directMessages: 'discussions:direct',
  /** The names the caller follows (S7) — one list per caller, like the mutes. */
  follows: 'follows',
  /** The Commons feed (S4) — one projection per caller. */
  commons: 'commons',
  /** A subject's proposals (social S3) — same shape as discussions. */
  socialProposals: (kind?: string, id?: string) => (kind && id ? `social-proposals:${kind}:${id}` : 'social-proposals'),
  socialProposal: (pid?: string) => (pid ? `social-proposal:${pid}` : 'social-proposal'),
  /** A Project's attention ledger (CW9, Phase G) — per-caller asks + counts. */
  attention: (projectId: string) => `attention:${projectId}`,
  /** The discovery directories (D17) — keyed per search so each query caches on its own. */
  directoryProjects: (q?: string) => (q ? `directory-projects:${q}` : 'directory-projects'),
  directoryAgents: (q?: string) => (q ? `directory-agents:${q}` : 'directory-agents'),
  /** A published definition's review queue (D25) — keyed per agent. */
  agentProposals: (agentId: string) => `agent-proposals:${agentId}`,
  /** A published definition's resolved-work track record (D13/S10) — keyed per agent;
   *  no-arg = the family prefix (invalidated whole on `openwork.changed`). */
  agentResolvedWork: (agentId?: string) => (agentId ? `agent-resolved-work:${agentId}` : 'agent-resolved-work'),
  /** A published definition's PUBLIC forks (D18) — keyed per agent; no-arg = the
   *  family prefix (invalidated wherever the agent directory is: fork / publish moves it). */
  agentForks: (agentId?: string) => (agentId ? `agent-forks:${agentId}` : 'agent-forks'),
  /** The caller's notification inbox (D24) + per-project watch state. */
  notifications: 'notifications',
  projectWatch: (projectId: string) => `project-watch:${projectId}`,
  /** A workspace's public face (D21) — keyed per display name; the no-arg call is
   *  the family prefix for `invalidatePrefix` (the directory-keys convention). */
  ownerProfile: (name?: string) => (name ? `owner-profile:${name}` : 'owner-profile'),
  /** Global search (D22) — keyed per query; no-arg = the family prefix. */
  search: (q?: string, page?: SearchPage) => q === undefined ? 'search' : `search:${JSON.stringify([q, page?.type ?? null, page?.offset ?? 0])}`,
  conversationSearch: (id?: string, q?: string, offset = 0) => {
    const family = id === undefined ? 'conversation-search' : `conversation-search:${JSON.stringify(id)}`
    return q === undefined ? family : `${family}:${JSON.stringify([q, offset])}`
  },
  runners: 'agents',
  runnerEffects: (id: string) => `runner-effects:${id}`,
  resourceStatus: (key: string) => `resource:${key}`,
  sessions: 'sessions',
  session: (id: string) => `session:${id}`,
  sessionCompactedMessages: (id: string, cursor?: string) =>
    `session-compacted-messages:${id}${cursor ? `:${cursor}` : ''}`,
  sessionContexts: (id: string) => `session-contexts:${id}`,
  toolActivityEligibility: (id: string, tenantId: string, userId: string) =>
    `tool-activity-eligibility:${JSON.stringify(id)}:${JSON.stringify([tenantId, userId])}`,
  toolActivityEligibilityPrefix: (id: string) => `tool-activity-eligibility:${JSON.stringify(id)}`,
  dispatch: 'dispatch',
  savedContexts: 'saved-contexts',
  contextCatalog: 'context-catalog',
  mcpConnections: 'mcp-connections',
  mcpConnection: (id: string) => `mcp-connection:${id}`,
  connectorDetail: (id: string | Connector) => `connector-detail:${typeof id === 'string' ? id : id.id}`,
  /** Keyed per session so the context-window figure tracks the open thread. */
  usage: (sessionId?: string) => (sessionId ? `usage:${sessionId}` : 'usage'),
  artifactContent: 'artifact-content',
  artifactTrash: 'artifact-trash',
  artifactLifecycle: (id?: string) => (id ? `artifact-lifecycle:${id}` : 'artifact-lifecycle'),
  scheduleTemplates: 'schedule-templates',
  // Served filesystem sources (Files / Photos / Folder — contract/fs.ts). Keyed per
  // source / path so each catalog + folder scan + file body caches on its own.
  fsSources: 'fs-sources',
  fsCatalog: (source: string) => `fs-catalog:${source}`,
  fsFolder: (source: string, path: string) => `fs-folder:${source}:${path}`,
  fsText: (source: string, path: string) => `fs-text:${source}:${path}`,
  projects: 'projects',
  artifacts: 'artifacts',
  schedules: 'schedules',
  scheduleMcpPermission: (id: string) => `schedule-mcp-permission:${id}`,
  relations: 'relations',
  recents: 'recents',
  /** The detective audit trail (docs/agent-commons.md, D15/OQ7) — the cross-user effect log. */
  auditLog: 'audit-log',
  /** The signed-in user's minted bearer-token registry rows (PORT-9 — metadata
   *  only; the token value is shown once, at mint). Read by the MCP access card;
   *  invalidated by its own mint/revoke commands. */
  apiTokens: 'api-tokens',
  /** The maintainer console's instance-wide reads (contract/admin.ts) — enabled
   *  only for `instanceAdmin` identities; invalidated by its own commands (v1
   *  has no admin SSE events — the panels re-read on their own acts + refresh). */
  adminUsers: 'admin-users',
  adminTenants: 'admin-tenants',
  adminInvites: 'admin-invites',
  adminTokens: 'admin-tokens',
  adminAudit: 'admin-audit',
  adminOps: 'admin-ops',
}

export const paths = {
  modelPreferences: '/viewer-preferences/model',
  imageAssets: '/image-assets',
  imageAssetContent: (id: string) => `/image-assets/${encodePathSegment(id)}/content`,
  imageAssetOriginal: (id: string) => `/image-assets/${encodePathSegment(id)}/original`,
  capabilities: '/capabilities',
  me: '/me',
  /** Mint (POST) / clear (DELETE) the verified session cookie (multi-account P6). */
  authSession: '/auth/session',
  /** Onboarding (P7): create a real, persisted account / sign one in. */
  authSignup: '/auth/signup',
  authLogin: '/auth/login',
  /** Mint a bearer credential from the current verified session (the MCP
   *  connect panel — access-parity INV-11). */
  authToken: '/auth/token',
  /** The minted-token registry (metadata list; DELETE by id revokes — the
   *  registry is the revocation authority, server/accounts.ts). */
  authTokens: '/auth/tokens',
  authTokenRevoke: (id: string) => `/auth/tokens/${encodePathSegment(id)}`,
  /** The account stack (§12): every account signed in on this browser. */
  authAccounts: '/auth/accounts',
  /** Forget ONE remembered account (DELETE — the switcher rows' hover sign-out). */
  authAccount: (userId: string) => `/auth/accounts/${encodePathSegment(userId)}`,
  /** Organizations (FWD-6): founding, the caller's seats/invites, the org ledger. */
  orgs: '/orgs',
  meOrgs: '/me/orgs',
  meInvites: '/me/invites',
  myInvite: (inviteId: string) => `/me/invites/${encodePathSegment(inviteId)}`,
  meWork: '/me/work',
  orgMembers: (orgId: string) => `/orgs/${orgId}/members`,
  orgInvites: (orgId: string) => `/orgs/${orgId}/invites`,
  orgInvite: (orgId: string, inviteId: string) =>
    `/orgs/${encodePathSegment(orgId)}/invites/${encodePathSegment(inviteId)}`,
  myInviteAccept: (inviteId: string) => `/me/invites/${encodePathSegment(inviteId)}/accept`,
  myInviteDecline: (inviteId: string) => `/me/invites/${encodePathSegment(inviteId)}/decline`,
  /** Reattach to a live server-owned turn (multi-account §5.2): replay after
   *  `after`, then the live tail. 404 once persisted (refetch the session). */
  turnStream: (id: string, turnId: string, after: number) =>
    `/sessions/${encodePathSegment(id)}/turns/${encodePathSegment(turnId)}/stream?after=${after}`,
  turnCancel: (id: string, turnId: string) =>
    `/sessions/${encodePathSegment(id)}/turns/${encodePathSegment(turnId)}/cancel`,
  providers: '/providers',
  provider: (id: string) => `/providers/${encodePathSegment(id)}`,
  providerConnection: (id: string) => `/providers/${encodePathSegment(id)}/connection`,
  providerRotate: (id: string) => `/providers/${encodePathSegment(id)}/rotate`,
  providerModelsRefresh: (id: string) => `/providers/${encodePathSegment(id)}/models/refresh`,
  systemPrompts: '/system-prompts',
  systemPrompt: (id: string) => `/system-prompts/${encodePathSegment(id)}`,
  agentTools: '/agent-tools',
  systemPromptProbe: (id: string) => `/system-prompts/${encodePathSegment(id)}/probe`,
  agents: '/agents',
  agent: (id: string) => `/agents/${encodePathSegment(id)}`,
  commissions: (projectId?: string) =>
    projectId ? `/commissions?project=${encodePathSegment(projectId)}` : '/commissions',
  commission: (id: string) => `/commissions/${encodePathSegment(id)}`,
  commissionAuthority: (id: string) => `/commissions/${encodePathSegment(id)}/authority`,
  projectSubGoals: (projectId: string) => `/projects/${encodePathSegment(projectId)}/subgoals`,
  openSubGoals: (projectId: string) => `/projects/${encodePathSegment(projectId)}/open-subgoals`,
  /** D23 — a work item's flat discussion thread + the honest close. */
  openSubGoalComments: (projectId: string, itemId: string) =>
    `/projects/${encodePathSegment(projectId)}/open-subgoals/${encodePathSegment(itemId)}/comments`,
  openSubGoalRetract: (projectId: string, itemId: string) =>
    `/projects/${encodePathSegment(projectId)}/open-subgoals/${encodePathSegment(itemId)}/retract`,
  /** A resource's grant roster (social S1) — the generic subject-ref read. */
  grants: (kind: string, id: string) => `/grants?kind=${encodePathSegment(kind)}&id=${encodePathSegment(id)}`,
  grantCreate: () => `/grants`,
  grantRevoke: (gid: string) => `/grants/${encodePathSegment(gid)}`,
  grantRedeem: () => `/grants/redeem`,
  /** A subject's discussions (social S2) + the per-discussion faces. */
  discussions: (kind: string, id: string) => `/discussions?kind=${encodePathSegment(kind)}&id=${encodePathSegment(id)}`,
  socialCapability: (kind: string, id: string) => `/social/capability?kind=${encodePathSegment(kind)}&id=${encodePathSegment(id)}`,
  sessionFork: (id: string) => `/sessions/${encodePathSegment(id)}/fork`,
  myDiscussions: () => `/discussions?mine=1`,
  /** The person layer (S7): the DM inbox, the follow list + its one act, and
   *  the per-thread read mark behind the inbox's unread count. */
  directMessages: () => `/discussions?direct=1`,
  follows: () => `/me/follows`,
  socialFollow: () => `/social/follow`,
  discussionRead: (did: string) => `/discussions/${encodePathSegment(did)}/read`,
  discussionReadState: (did: string, throughPostId: string) =>
    `/discussions/${encodePathSegment(did)}/read?throughPostId=${encodePathSegment(throughPostId)}`,
  /** The Commons feed (S4) + the acts behind its lenses: a like on one item, a
   *  watch on any subject, and the note that you opened one. */
  commons: () => `/commons`,
  commonsLike: (itemId: string) => `/commons/${encodePathSegment(itemId)}/like`,
  socialWatch: () => `/social/watch`,
  socialWatchState: (kind: string, id: string) =>
    `/social/watch?kind=${encodePathSegment(kind)}&id=${encodePathSegment(id)}`,
  socialViewed: () => `/social/viewed`,
  /** A subject's proposals (social S3) + the per-proposal faces. */
  socialProposals: (kind: string, id: string) => `/proposals?kind=${encodePathSegment(kind)}&id=${encodePathSegment(id)}`,
  socialProposalOpen: () => `/proposals`,
  socialProposal: (pid: string) => `/proposals/${encodePathSegment(pid)}`,
  socialProposalLand: (pid: string) => `/proposals/${encodePathSegment(pid)}/land`,
  socialProposalDecline: (pid: string) => `/proposals/${encodePathSegment(pid)}/decline`,
  discussionOpen: () => `/discussions`,
  discussion: (did: string) => `/discussions/${encodePathSegment(did)}`,
  discussionPosts: (did: string) => `/discussions/${encodePathSegment(did)}/posts`,
  discussionReact: (did: string, pid: string) => `/discussions/${encodePathSegment(did)}/posts/${encodePathSegment(pid)}/react`,
  discussionPost: (did: string, pid: string, cascade = false) =>
    `/discussions/${encodePathSegment(did)}/posts/${encodePathSegment(pid)}${cascade ? '?cascade=1' : ''}`,
  discussionPostReport: (did: string, pid: string) => `/discussions/${encodePathSegment(did)}/posts/${encodePathSegment(pid)}/report`,
  discussionResolve: (did: string) => `/discussions/${encodePathSegment(did)}/resolve`,
  /** The contribution ledger (agent-contribution workflow Phase A). */
  contributions: (projectId: string) => `/projects/${encodePathSegment(projectId)}/contributions`,
  contributionComments: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/comments`,
  contributionLand: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/land`,
  contributionEnvelope: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/envelope`,
  contributionEnvelopeApprove: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/envelope/approve`,
  contributionEffects: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/effects`,
  contributionChangeset: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/changeset`,
  contributionReview: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/review`,
  contributionRequireReview: (projectId: string, cid: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/require-review`,
  delegations: (projectId: string) => `/projects/${encodePathSegment(projectId)}/delegations`,
  delegation: (projectId: string, did: string) =>
    `/projects/${encodePathSegment(projectId)}/delegations/${encodePathSegment(did)}`,
  attention: (projectId: string) => `/projects/${encodePathSegment(projectId)}/attention`,
  contributionDelegated: (projectId: string, cid: string, did: string) =>
    `/projects/${encodePathSegment(projectId)}/contributions/${encodePathSegment(cid)}/delegated/${encodePathSegment(did)}`,
  agentFork: (id: string) => `/agents/${encodePathSegment(id)}/fork`,
  directoryProjects: (q?: string) => (q ? `/directory/projects?q=${encodePathSegment(q)}` : '/directory/projects'),
  directoryAgents: (q?: string) => (q ? `/directory/agents?q=${encodePathSegment(q)}` : '/directory/agents'),
  /** Change proposals against a published definition (D25). */
  agentProposals: (agentId: string) => `/agents/${encodePathSegment(agentId)}/proposals`,
  agentResolvedWork: (agentId: string) => `/agents/${encodePathSegment(agentId)}/resolved-work`,
  agentForks: (agentId: string) => `/agents/${encodePathSegment(agentId)}/forks`,
  agentProposalMerge: (agentId: string, pid: string) =>
    `/agents/${encodePathSegment(agentId)}/proposals/${encodePathSegment(pid)}/merge`,
  agentProposalDecline: (agentId: string, pid: string) =>
    `/agents/${encodePathSegment(agentId)}/proposals/${encodePathSegment(pid)}/decline`,
  agentProposalComments: (agentId: string, pid: string) =>
    `/agents/${encodePathSegment(agentId)}/proposals/${encodePathSegment(pid)}/comments`,
  /** The notification inbox + watch acts (D24). */
  notifications: '/notifications',
  notificationsRead: '/notifications/read',
  notificationsReadState: (...ids: string[]) =>
    `/notifications/read?${ids.map((id) => `id=${encodePathSegment(id)}`).join('&')}`,
  projectWatch: (projectId: string) => `/projects/${encodePathSegment(projectId)}/watch`,
  /** The workspace profile (D21) — the display name IS the public handle. */
  ownerProfile: (name: string) => `/directory/owners/${encodePathSegment(name)}`,
  /** Global search (D22): typed grouped hits across everything the caller can see. */
  search: (q: string, page?: SearchPage) => `/search?q=${encodePathSegment(q)}${page ? `&type=${encodePathSegment(page.type)}&offset=${page.offset}` : ''}`,
  conversationSearch: (id: string, q: string, offset = 0) => `/sessions/${encodePathSegment(id)}/search?q=${encodePathSegment(q)}&offset=${offset}`,
  /** The A2A edge (docs/a2a-integration.md, D20). `a2aAgentCard` is a public GET a
   *  foreign agent (or a curious human) can open; `agentImportCard` is the outbound
   *  fetch-a-remote-card mint. */
  a2aAgentCard: (id: string) => `/a2a/agents/${encodePathSegment(id)}/card`,
  agentImportCard: '/agents/import-card',
  // The native-only endpoints (`/fs/pick`, `/fs/folders/:id`, `/git/repos/:id/diff`)
  // are intentionally absent here — no live UI flow calls them. They exist behind the
  // capability gate and are exercised by the contract via tests + `BACKEND=remote`
  // (which 409s them); that gate, not a client caller, is what demonstrates portability.
  runners: '/runners',
  runner: (id: string) => `/runners/${encodePathSegment(id)}`,
  runnerInvoke: (id: string) => `/runners/${encodePathSegment(id)}/invoke`,
  runnerEffects: (id: string) => `/runners/${encodePathSegment(id)}/effects`,
  runnerSync: (id: string) => `/runners/${encodePathSegment(id)}/sync`,
  resource: (key: string) => `/resources/${encodePathSegment(key)}`,
  resourceReserve: (key: string) => `/resources/${encodePathSegment(key)}/reserve`,
  reservationCommit: (id: string) => `/reservations/${encodePathSegment(id)}/commit`,
  reservationRelease: (id: string) => `/reservations/${encodePathSegment(id)}/release`,
  sessions: '/sessions',
  session: (id: string, page?: { limit: number; cursor?: string }) => {
    const base = `/sessions/${encodePathSegment(id)}`
    if (!page) return base
    const cursor = page.cursor ? `&messageCursor=${encodePathSegment(page.cursor)}` : ''
    return `${base}?messageLimit=${page.limit}${cursor}`
  },
  sessionMessages: (id: string) => `/sessions/${encodePathSegment(id)}/messages`,
  sessionExport: (id: string) => `/sessions/${encodePathSegment(id)}/export`,
  sessionContexts: (id: string) => `/sessions/${encodePathSegment(id)}/contexts`,
  sessionContextState: (id: string) => `/sessions/${encodePathSegment(id)}/context-state`,
  toolActivityEligibility: (id: string) =>
    `/sessions/${encodePathSegment(id)}/tool-activity-eligibility`,
  sessionPreferences: (id: string) => `/sessions/${encodePathSegment(id)}/preferences`,
  toolActivity: (id: string, activityId: string) =>
    `/sessions/${encodePathSegment(id)}/tool-activities/${encodePathSegment(activityId)}`,
  sessionCompact: (id: string) => `/sessions/${encodePathSegment(id)}/compact`,
  sessionCompactedMessages: (id: string, page: { limit: number; cursor?: string }) => {
    const cursor = page.cursor ? `&cursor=${encodePathSegment(page.cursor)}` : ''
    return `/sessions/${encodePathSegment(id)}/compacted-messages?limit=${page.limit}${cursor}`
  },
  messageRelations: (id: string, messageId: string) =>
    `/sessions/${encodePathSegment(id)}/messages/${encodePathSegment(messageId)}/relations`,
  dispatch: '/dispatch',
  savedContexts: '/saved-contexts',
  contextCatalog: '/context-catalog',
  savedContext: (id: string) => `/saved-contexts/${encodePathSegment(id)}`,
  mcpConnections: '/mcp-connections',
  mcpConnection: (id: string) => `/mcp-connections/${encodePathSegment(id)}`,
  mcpConnectionInspect: (id: string) => `/mcp-connections/${encodePathSegment(id)}/inspect`,
  mcpConnectionDisconnect: (id: string) => `/mcp-connections/${encodePathSegment(id)}/disconnect`,
  mcpConnectionCleanup: (id: string) => `/mcp-connections/${encodePathSegment(id)}/credential-cleanup`,
  mcpConnectionCredentialBinding: (id: string) => `/mcp-connections/${encodePathSegment(id)}/credential-binding`,
  connectorDetail: (c: Connector) => {
    const q = new URLSearchParams({ id: c.id, label: c.label })
    if (c.kind) q.set('kind', c.kind)
    return `/connectors/detail?${q.toString()}`
  },
  usage: (sessionId?: string) => (sessionId ? `/usage?session=${encodePathSegment(sessionId)}` : '/usage'),
  /** S8 — the square's compose door: say something with no resource attached. */
  posts: '/posts',
  artifactContent: '/artifact-content',
  /** The owner's body-edit door (social S3) — one addressed prose block. */
  artifactContentEdit: (id: string) => `/artifacts/${encodePathSegment(id)}/content`,
  /** Owner-only reviewed permanent deletion from Trash. */
  artifactDeletionPreview: (id: string) => `/artifacts/${encodePathSegment(id)}/deletion-preview`,
  /** Owner-only retained Artifact body history and exact revision restore. */
  artifactHistory: (id: string, beforeRevision?: number, limit = 50) => {
    const query = new URLSearchParams({ limit: String(limit) })
    if (beforeRevision !== undefined) query.set('beforeRevision', String(beforeRevision))
    return `/artifacts/${encodePathSegment(id)}/history?${query.toString()}`
  },
  artifactHistoryVersion: (id: string, revision: number) =>
    `/artifacts/${encodePathSegment(id)}/history/${encodePathSegment(String(revision))}`,
  artifactHistoryRestore: (id: string, revision: number) =>
    `/artifacts/${encodePathSegment(id)}/history/${encodePathSegment(String(revision))}/restore`,
  scheduleTemplates: '/schedule-templates',
  // Served filesystem sources (contract/fs.ts). `fsContent` returns raw bytes (an
  // image / binary), used directly as an `<img src>` — not via `apiGet` (which
  // JSON-parses); resolve it to an absolute URL with `fsContentUrl` in client.ts.
  fsSources: '/fs/sources',
  fsCatalog: (source: string) => `/fs/catalog?source=${encodePathSegment(source)}`,
  fsFolder: (source: string, path: string) =>
    `/fs/folder?source=${encodePathSegment(source)}&path=${encodePathSegment(path)}`,
  fsText: (source: string, path: string) =>
    `/fs/text?source=${encodePathSegment(source)}&path=${encodePathSegment(path)}`,
  fsSnapshot: (source: string, path: string) =>
    `/fs/snapshot?source=${encodePathSegment(source)}&path=${encodePathSegment(path)}`,
  fsFolderSnapshot: (source: string, path: string) =>
    `/fs/folder-snapshot?source=${encodePathSegment(source)}&path=${encodePathSegment(path)}`,
  refreshSessionAttachment: (sessionId: string, attachmentId: string) =>
    `/sessions/${encodePathSegment(sessionId)}/attachments/${encodePathSegment(attachmentId)}/refresh`,
  refreshSessionFolder: (sessionId: string, folderId: string) =>
    `/sessions/${encodePathSegment(sessionId)}/folders/${encodePathSegment(folderId)}/refresh`,
  refreshLocalSessionFolder: (sessionId: string, folderId: string) =>
    `/sessions/${encodePathSegment(sessionId)}/local-folders/${encodePathSegment(folderId)}/refresh`,
  refreshLocalGitSessionFolder: (sessionId: string, folderId: string) =>
    `/sessions/${encodePathSegment(sessionId)}/workspace/folders/${encodePathSegment(folderId)}/local-git-refresh`,
  fsContent: (source: string, path: string) =>
    `/fs/content?source=${encodePathSegment(source)}&path=${encodePathSegment(path)}`,
  projects: '/projects',
  artifacts: '/artifacts',
  artifact: (id: string) => `/artifacts/${encodePathSegment(id)}`,
  artifactTrash: '/artifacts/trash',
  artifactLifecycle: (id: string) => `/artifacts/${encodePathSegment(id)}/lifecycle`,
  artifactExport: (id: string, format?: 'xlsx' | 'pptx' | 'docx') => {
    const path = `/artifacts/${encodePathSegment(id)}/export`
    return format ? `${path}?format=${format}` : path
  },
  schedules: '/schedules',
  schedule: (id: string) => `/schedules/${encodePathSegment(id)}`,
  scheduleRun: (id: string) => `/schedules/${encodePathSegment(id)}/run`,
  scheduleMcpPermission: (id: string) => `/schedules/${encodePathSegment(id)}/mcp-permission`,
  relations: '/relations',
  relationOps: '/relations/ops',
  recents: '/recents',
  recentsType: (type: string) => `/recents/${encodePathSegment(type)}`,
  audit: '/audit',
  /** The maintainer console (`/admin/*` — maintainer-walled, contract/admin.ts). */
  adminUsers: '/admin/users',
  adminTenants: '/admin/tenants',
  adminInvites: '/admin/invites',
  adminTokens: '/admin/tokens',
  adminAudit: '/admin/audit',
  adminOps: '/admin/ops',
  adminUserDeactivate: (id: string) => `/admin/users/${encodePathSegment(id)}/deactivate`,
  adminTokenRevoke: (userId: string, id: string) =>
    `/admin/tokens/${encodePathSegment(userId)}/${encodePathSegment(id)}`,
  adminInviteRevoke: (id: string) => `/admin/invites/${encodePathSegment(id)}`,
}
