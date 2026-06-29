/** ── The resource-manipulation tool interface ───────────────────────────────
 *  Every change Claude can make to the workspace's resources — open a workspace,
 *  connect a repo, create a project, save an artifact, link a schedule — is a
 *  **tool** here. This is the real Anthropic tool-use surface: the backend
 *  declares `TOOL_DEFINITIONS` in the Messages request, the model answers with
 *  `tool_use` blocks, and the backend *executes* each call with `executeTool`,
 *  turning it into the structured side-effect the UI consents to (a relation-edit
 *  card, or an escalation prompt). Nothing is applied until the user confirms — a
 *  tool call is a *proposal*, so `executeTool` builds the proposal and reports
 *  "awaiting confirmation" back to the model.
 *
 *  The catalog is one data table (DRY): `TOOLS`. `TOOL_DEFINITIONS` is the
 *  Anthropic schema derived from it; `executeTool` dispatches through it. The mock
 *  model (server/model/intents.ts) decides *which* tool to call; this module is
 *  the production-real executor of whatever it calls. */
import { ALL_ARTIFACTS, PROJECTS, SCHEDULED_TASKS } from '../data/cowork.ts'
import { CONNECTOR_OPTIONS } from '../data/contextOptions.ts'
import { slug } from '../../contract/ids.ts'
import { PROJECT_ROLES } from '../../contract/index.ts'
import type {
  Artifact,
  ArtifactKind,
  Connector,
  DiffLine,
  EscalationProposal,
  FileNode,
  ProjectContext,
  ProjectRole,
  RelationOp,
  StepTool,
} from '../../contract/index.ts'

/** The session a tool runs against — its id + title, for ops that file/save out
 *  of "this session". */
export interface ToolContext {
  session: { id: string; title: string }
  /** The live Agent Commons registries (docs/agent-commons.md, D6/D9/D10), supplied by
   *  the route from the store. The Agent Commons CRUD tools resolve the model's named
   *  provider / prompt / agent against *what currently exists* — including entities
   *  created earlier in the same conversation — not just the seed. Absent in unit calls
   *  that don't exercise those tools. */
  commons?: {
    providers: { id: string; label: string }[]
    systemPrompts: { id: string; label: string }[]
    agents: { id: string; label: string }[]
    commissions: { id: string; agentId: string; projectId: string }[]
  }
}

/** What executing one tool produces: the consent-gated side-effect(s) plus a
 *  one-line `summary` fed back to the model as the `tool_result` (honest: the
 *  proposal is shown to the user, not yet applied). */
export interface ToolEffect {
  relationOps?: RelationOp[]
  escalation?: EscalationProposal
  summary: string
}

/** A JSON-schema property (the slice the Anthropic `input_schema` needs). */
type JsonProp = { type: string; description: string; items?: { type: string } }

interface ToolSpec {
  name: string
  description: string
  properties: Record<string, JsonProp>
  required: string[]
  /** Execute the call: resolve the model's named args against the real catalogs
   *  and build the proposal. */
  build: (input: Record<string, unknown>, ctx: ToolContext) => ToolEffect
}

// ── Resolvers — turn the model's *names* into real graph ids ──────────────────
// The model proposes in human terms ("file under Insights dashboard"); the
// backend resolves that to the concrete id the graph uses. Case-insensitive,
// with a sensible fallback so a tour fixed-string always lands.

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown): boolean => v === true

function resolveProject(name: string) {
  const n = name.trim().toLowerCase()
  return PROJECTS.find((p) => p.name.toLowerCase() === n) ?? PROJECTS.find((p) => p.name.toLowerCase().includes(n) && n) ?? PROJECTS[0]
}
function resolveArtifact(name: string) {
  const n = name.trim().toLowerCase()
  return ALL_ARTIFACTS.find((a) => a.name.toLowerCase() === n) ?? ALL_ARTIFACTS.find((a) => a.name.toLowerCase().includes(n) && n) ?? ALL_ARTIFACTS[0]
}
function resolveSchedule(name: string) {
  const n = name.trim().toLowerCase()
  return SCHEDULED_TASKS.find((s) => s.name.toLowerCase() === n) ?? SCHEDULED_TASKS.find((s) => s.name.toLowerCase().includes(n) && n) ?? SCHEDULED_TASKS[0]
}
function resolveConnector(name: string): { id: string; label: string; kind?: Connector['kind'] } {
  const n = name.trim().toLowerCase()
  return (
    CONNECTOR_OPTIONS.find((c) => c.label.toLowerCase() === n) ??
    CONNECTOR_OPTIONS.find((c) => c.label.toLowerCase().includes(n) && n) ?? { id: slug(name), label: name }
  )
}
const ARTIFACT_KINDS: ArtifactKind[] = ['doc', 'email', 'image', 'slide', 'sheet']
function resolveKind(v: unknown): ArtifactKind {
  const k = str(v).toLowerCase()
  return (ARTIFACT_KINDS as string[]).includes(k) ? (k as ArtifactKind) : 'doc'
}

// Resolve a named Agent Commons entity against the LIVE registry the route passed in
// (ctx.commons). Exact label first, then a contains-match; undefined when nothing
// matches (unlike the seed resolvers, which fall back to [0] — a wrong provider/agent
// guess here would be worse than proposing nothing).
function byLabel<T extends { label: string }>(list: T[] | undefined, name: string): T | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return list?.find((x) => x.label.toLowerCase() === n) ?? list?.find((x) => x.label.toLowerCase().includes(n))
}

// ── Escalation panel content — what a panel-producing tool *yields* ───────────
// In reality the model decides "open a workspace / branch the repo"; the bytes
// (the artifacts it drafts, the diff it writes, the terminal it ran) are the
// effect of *executing* that. So they live here, backend-side, as the tool's
// output — not as a client fixture.

const WORKSPACE_ROOTS = ['~/work/insights-dashboard-launch/', '~/projects/insights/', '~/Desktop/']
const WORKSPACE_ARTIFACTS: Artifact[] = [
  { id: 'art-onepager', name: 'insights-onepager.md', kind: 'doc', meta: 'draft · 1 page' },
  { id: 'art-email', name: 'launch-email.md', kind: 'email', meta: 'draft · to: admins' },
  { id: 'art-hero', name: 'insights-hero.png', kind: 'image', meta: '1600×900 · generated' },
  { id: 'art-voice-guide', name: 'voice-guide.md', kind: 'doc', meta: 'reference', source: { id: 'src-brand-kit', label: 'brand-kit/' } },
  { id: 'art-wordmark', name: 'wordmark-lockups.png', kind: 'image', meta: 'reference', source: { id: 'src-brand-kit', label: 'brand-kit/' } },
  { id: 'art-q1-email', name: 'q1-launch-email.md', kind: 'email', meta: 'reused', source: { id: 'src-launch-assets', label: 'launch-assets/' } },
]
const REPO_REMOTE = 'patrick-yingxi-pan/web-app'
const REPO_BRANCH = 'feat/insights-dashboard'
const REPO_FILES: FileNode[] = [
  { path: 'web/src/routes/insights.tsx', status: 'added' },
  { path: 'web/src/lib/flags.ts', status: 'modified' },
  { path: 'web/src/nav/Sidebar.tsx', status: 'modified' },
]
const REPO_DIFF: DiffLine[] = [
  { kind: 'hunk', text: 'web/src/lib/flags.ts' },
  { kind: 'ctx', text: 'export const flags = {' },
  { kind: 'ctx', text: '  billingV2: true,' },
  { kind: 'add', text: '  insightsDashboard: true,' },
  { kind: 'ctx', text: '  exportCsv: true,' },
  { kind: 'ctx', text: '}' },
]
const REPO_TERMINAL = [
  '$ git checkout -b feat/insights-dashboard',
  "Switched to a new branch 'feat/insights-dashboard'",
  '$ npm test -- insights',
  'PASS  web/src/routes/insights.test.tsx (3.1s)',
  'Tests: 7 passed, 7 total',
]
/** The fresh project the tour's create_project spins up (distinct from the seeded
 *  `p-insights`, so the "file this session into a new project" move is real). */
const TOUR_PROJECT = {
  id: 'p-insights-launch',
  name: 'Insights dashboard launch',
  description:
    'Everything for the Insights dashboard launch — the strategy thread, the one-pager and email, and the feature-flagged rollout.',
}
const TOUR_PROJECT_VISIT_CAPTION =
  'Here it is: a brand-new project with this session already filed inside. Same conversation — now it has a home, and everything it produces will collect here. Next heads back to the thread to wrap up.'

// ── The catalog ───────────────────────────────────────────────────────────────
// One entry per resource manipulation. The 3 panel-escalation tools produce an
// `escalation`; the rest produce `relationOps` — the relationship edits plus the
// Agent Commons CRUD ops (create provider / prompt / agent, (un)commission an agent).

const TOOLS: ToolSpec[] = [
  // ── Panel escalations ──────────────────────────────────────────────────────
  {
    name: 'open_workspace',
    description:
      'Open a Cowork workspace on the conversation and draft documents into it, optionally pulling reference folders in for context. Use when the user asks to produce docs, drafts, or assets. The user is prompted to pick a root folder before it opens.',
    properties: {
      sources: { type: 'array', description: 'Folders to pull in for reference, e.g. ["brand-kit/", "launch-assets/"].', items: { type: 'string' } },
    },
    required: [],
    build: () => ({
      escalation: { kind: 'workspace', rootChoices: WORKSPACE_ROOTS, artifacts: WORKSPACE_ARTIFACTS },
      summary: `Proposed opening a workspace with ${WORKSPACE_ARTIFACTS.length} drafts; awaiting the user's folder choice and approval.`,
    }),
  },
  {
    name: 'connect_repo',
    description:
      'Connect the user\'s git repo and the GitHub connector to the conversation, branch, make the change, and run tests — the inline coding session. Use when the user asks to change code, add a route, or put something behind a flag. The user is prompted to connect before it attaches.',
    properties: {
      branch: { type: 'string', description: 'The branch to create, e.g. "feat/insights-dashboard".' },
      remote: { type: 'string', description: 'The GitHub remote owner/name, e.g. "patrick-yingxi-pan/web-app".' },
    },
    required: [],
    build: (input) => ({
      escalation: {
        kind: 'repo',
        connectorLabel: 'GitHub',
        remote: str(input.remote, REPO_REMOTE),
        branch: str(input.branch, REPO_BRANCH),
        files: REPO_FILES,
        diff: REPO_DIFF,
        terminal: REPO_TERMINAL,
        connectors: [{ id: 'gh-mcp', label: 'GitHub', kind: 'github' }],
      },
      summary: `Proposed connecting ${str(input.remote, REPO_REMOTE)} on branch ${str(input.branch, REPO_BRANCH)} with a ${REPO_DIFF.length}-line diff; awaiting the user's approval to connect.`,
    }),
  },
  {
    name: 'create_project',
    description:
      'Create a new project and file the current session into it, giving an effort that has outgrown a single thread a home. Use when the user asks to organize the work into a project. The user is prompted to approve before the project is created.',
    properties: {
      name: { type: 'string', description: 'The project name, e.g. "Insights dashboard launch".' },
      description: { type: 'string', description: 'A one-line description of what the project collects.' },
      file_session: { type: 'string', description: 'Set "true" to file the current session into the new project (the usual case).' },
    },
    required: ['name'],
    build: (input) => {
      // The tour's canonical project carries its own id + visit caption; a
      // free-typed "create a project called X" mints an id from the name.
      const name = str(input.name).trim()
      const isTour = name.toLowerCase() === TOUR_PROJECT.name.toLowerCase()
      const project = isTour
        ? TOUR_PROJECT
        : { id: `p-${slug(name)}`, name, description: str(input.description, `Everything for ${name}.`) }
      // `file_session` defaults to true (the usual "create + file" move); the tour
      // passes "false" so a later file_session beat demonstrates filing on its own.
      const fileSession = str(input.file_session, 'true').toLowerCase() !== 'false'
      return {
        escalation: { kind: 'project', project, fileSession, visitCaption: isTour ? TOUR_PROJECT_VISIT_CAPTION : undefined },
        summary: `Proposed creating the ${project.name} project${fileSession ? ' and filing this session into it' : ''}; awaiting the user's approval.`,
      }
    },
  },

  // ── Relation-op tools — one per RelationOp kind ─────────────────────────────
  {
    name: 'file_session',
    description: 'File (move) the current session into an existing project, or remove it from its project. Edits the session ↔ project relation.',
    properties: {
      project: { type: 'string', description: 'The project to file the session under, e.g. "Insights dashboard".' },
      remove: { type: 'string', description: 'Set "true" to remove the session from the project instead of filing it.' },
    },
    required: ['project'],
    build: (input, ctx) => {
      const p = resolveProject(str(input.project))
      const op: RelationOp = bool(input.remove)
        ? { kind: 'file-session', sessionId: ctx.session.id, sessionTitle: ctx.session.title, projectId: null, projectName: p.name }
        : { kind: 'file-session', sessionId: ctx.session.id, sessionTitle: ctx.session.title, projectId: p.id, projectName: p.name }
      return { relationOps: [op], summary: `Proposed ${bool(input.remove) ? 'unfiling' : 'filing'} this session ${bool(input.remove) ? 'from' : 'under'} ${p.name}; awaiting confirmation.` }
    },
  },
  {
    name: 'save_artifact',
    description: 'Save a draft from this session as an artifact, optionally filing it under a project. Edits the session ↔ artifact relation.',
    properties: {
      name: { type: 'string', description: 'The artifact file name, e.g. "launch-recap.md".' },
      kind: { type: 'string', description: 'One of doc, email, image, slide, sheet.' },
      meta: { type: 'string', description: 'A short meta line, e.g. "1 page".' },
      excerpt: { type: 'string', description: 'A one-line excerpt of the artifact.' },
      project: { type: 'string', description: 'Optional project to file the new artifact under.' },
    },
    required: ['name'],
    build: (input, ctx) => {
      const project = str(input.project) ? resolveProject(str(input.project)) : undefined
      const op: RelationOp = {
        kind: 'save-artifact',
        artifact: { name: str(input.name, 'session-recap.md'), kind: resolveKind(input.kind), meta: str(input.meta, '1 page'), excerpt: str(input.excerpt) || undefined },
        sessionId: ctx.session.id,
        sessionTitle: ctx.session.title,
        projectId: project?.id,
        projectName: project?.name,
      }
      return { relationOps: [op], summary: `Proposed saving ${str(input.name, 'an artifact')}${project ? ` under ${project.name}` : ''}; awaiting confirmation.` }
    },
  },
  {
    name: 'refile_artifact',
    description: 'Move an existing artifact into a project (or remove it from its project). Edits the project ↔ artifact relation.',
    properties: {
      artifact: { type: 'string', description: 'The artifact name to move, e.g. "insights-onepager.md".' },
      project: { type: 'string', description: 'The destination project.' },
      remove: { type: 'string', description: 'Set "true" to remove the artifact from its project instead.' },
    },
    required: ['artifact'],
    build: (input) => {
      const a = resolveArtifact(str(input.artifact))
      const p = resolveProject(str(input.project))
      const op: RelationOp = bool(input.remove)
        ? { kind: 'refile-artifact', artifactId: a.id, artifactName: a.name, projectId: null, projectName: p.name }
        : { kind: 'refile-artifact', artifactId: a.id, artifactName: a.name, projectId: p.id, projectName: p.name }
      return { relationOps: [op], summary: `Proposed moving ${a.name}${bool(input.remove) ? ' out of its project' : ` into ${p.name}`}; awaiting confirmation.` }
    },
  },
  {
    name: 'attach_context',
    description: 'Attach a connector or context (GitHub, Linear, Figma, …) to the current session. Edits the session ↔ context relation.',
    properties: { connector: { type: 'string', description: 'The connector to attach, e.g. "Linear".' } },
    required: ['connector'],
    build: (input, ctx) => {
      const c = resolveConnector(str(input.connector))
      const op: RelationOp = { kind: 'attach-context', sessionTitle: ctx.session.title, connectorId: c.id, connectorLabel: c.label, connectorKind: c.kind }
      return { relationOps: [op], summary: `Proposed attaching ${c.label} to this session; awaiting confirmation.` }
    },
  },
  {
    name: 'scope_context',
    description: 'Scope a connector/context to a project so every session in it inherits it. Edits the project ↔ context relation.',
    properties: {
      connector: { type: 'string', description: 'The context to scope, e.g. "Figma".' },
      project: { type: 'string', description: 'The project to scope it to.' },
    },
    required: ['connector', 'project'],
    build: (input) => {
      const c = resolveConnector(str(input.connector))
      const p = resolveProject(str(input.project))
      const context: ProjectContext = { kind: 'connector', label: c.label, meta: 'connected' }
      return { relationOps: [{ kind: 'scope-context', projectId: p.id, projectName: p.name, context }], summary: `Proposed scoping ${c.label} to ${p.name}; awaiting confirmation.` }
    },
  },
  {
    name: 'unscope_context',
    description: 'Remove a scoped context from a project (the inverse of scope_context). Edits the project ↔ context relation.',
    properties: {
      context: { type: 'string', description: 'The context label to remove, e.g. "Figma".' },
      project: { type: 'string', description: 'The project to remove it from.' },
    },
    required: ['context', 'project'],
    build: (input) => {
      const p = resolveProject(str(input.project))
      const label = str(input.context)
      return { relationOps: [{ kind: 'unscope-context', projectId: p.id, projectName: p.name, contextLabel: label }], summary: `Proposed removing ${label} from ${p.name}; awaiting confirmation.` }
    },
  },
  {
    name: 'set_project_instructions',
    description: "Update a project's custom instructions (the standing guidance every session in it follows). Edits the project ↔ context relation.",
    properties: {
      project: { type: 'string', description: 'The project to update.' },
      instructions: { type: 'string', description: 'The new instructions text.' },
    },
    required: ['project', 'instructions'],
    build: (input) => {
      const p = resolveProject(str(input.project))
      return { relationOps: [{ kind: 'set-project-instructions', projectId: p.id, projectName: p.name, instructions: str(input.instructions) }], summary: `Proposed updating ${p.name}'s instructions; awaiting confirmation.` }
    },
  },
  {
    name: 'link_schedule_project',
    description: "Link a recurring schedule to a project so its cadence lives with the project (or unlink it). Edits the project ↔ schedule relation.",
    properties: {
      schedule: { type: 'string', description: 'The schedule to link, e.g. "Triage new GitHub issues".' },
      project: { type: 'string', description: 'The project to link it to.' },
      remove: { type: 'string', description: 'Set "true" to unlink instead.' },
    },
    required: ['schedule', 'project'],
    build: (input) => {
      const s = resolveSchedule(str(input.schedule))
      const p = resolveProject(str(input.project))
      const op: RelationOp = bool(input.remove)
        ? { kind: 'link-schedule-project', scheduleId: s.id, scheduleName: s.name, projectId: null, projectName: p.name }
        : { kind: 'link-schedule-project', scheduleId: s.id, scheduleName: s.name, projectId: p.id, projectName: p.name }
      return { relationOps: [op], summary: `Proposed ${bool(input.remove) ? 'unlinking' : 'linking'} ${s.name} ${bool(input.remove) ? 'from' : 'to'} ${p.name}; awaiting confirmation.` }
    },
  },
  {
    name: 'set_artifact_source',
    description: 'Record that an artifact derives from a context (e.g. a brand kit). Edits the artifact ↔ context relation.',
    properties: {
      artifact: { type: 'string', description: 'The artifact name.' },
      context: { type: 'string', description: 'The source context label, e.g. "brand-kit/".' },
    },
    required: ['artifact', 'context'],
    build: (input) => {
      const a = resolveArtifact(str(input.artifact))
      const label = str(input.context)
      return { relationOps: [{ kind: 'set-artifact-source', artifactId: a.id, artifactName: a.name, contextLabel: label }], summary: `Proposed noting ${a.name} derives from ${label}; awaiting confirmation.` }
    },
  },
  {
    name: 'set_schedule_session',
    description: 'Have a recurring schedule open a fresh session each run. A standing approval — approved once, then runs unprompted. Edits the session ↔ schedule relation.',
    properties: {
      schedule: { type: 'string', description: 'The schedule, e.g. "Daily AI news briefing".' },
      session_label: { type: 'string', description: 'What to label the session it opens each run.' },
    },
    required: ['schedule'],
    build: (input) => {
      const s = resolveSchedule(str(input.schedule))
      return { relationOps: [{ kind: 'set-schedule-session', scheduleId: s.id, scheduleName: s.name, cadence: s.cadence, sessionLabel: str(input.session_label, 'New session') }], summary: `Proposed having ${s.name} open a fresh session each run; awaiting confirmation.` }
    },
  },
  {
    name: 'set_schedule_artifact',
    description: 'Have a recurring schedule save (overwrite) an artifact each run — e.g. a digest. A standing approval. Edits the artifact ↔ schedule relation.',
    properties: {
      schedule: { type: 'string', description: 'The schedule, e.g. "Triage new GitHub issues".' },
      artifact: { type: 'string', description: 'The artifact it saves each run, e.g. "triage-digest.md".' },
    },
    required: ['schedule'],
    build: (input) => {
      const s = resolveSchedule(str(input.schedule))
      return { relationOps: [{ kind: 'set-schedule-artifact', scheduleId: s.id, scheduleName: s.name, cadence: s.cadence, artifactName: str(input.artifact, 'digest.md') }], summary: `Proposed having ${s.name} save ${str(input.artifact, 'a digest')} each run; awaiting confirmation.` }
    },
  },
  {
    name: 'schedule_add_tool',
    description: 'Add a tool/connector a recurring schedule uses each run. A standing approval. Edits the context ↔ schedule relation.',
    properties: {
      schedule: { type: 'string', description: 'The schedule.' },
      tool: { type: 'string', description: 'The tool/connector to add, e.g. "Slack".' },
    },
    required: ['schedule', 'tool'],
    build: (input) => {
      const s = resolveSchedule(str(input.schedule))
      const c = resolveConnector(str(input.tool))
      const tool: StepTool = { id: c.id, label: c.label, tone: 'connector' }
      return { relationOps: [{ kind: 'schedule-add-tool', scheduleId: s.id, scheduleName: s.name, cadence: s.cadence, tool }], summary: `Proposed letting ${s.name} use ${c.label} each run; awaiting confirmation.` }
    },
  },

  // ── Agent Commons CRUD tools (docs/agent-commons.md, D6/D9/D10/D7) ───────────
  // Claude managing the Agent Commons concepts through the SAME confirm-card gate.
  // Each yields a RelationOp the user confirms; the canonical write then executes it
  // through the store's registry mutator (the D8 funnel) — server/store.ts.
  {
    name: 'create_provider',
    description:
      'Register a new Model provider — a cognition source (a Messages-API integration) that worker Agents can run on. Use when the user asks to add or register a model provider. The user confirms before it is registered.',
    properties: {
      label: { type: 'string', description: 'The provider name, e.g. "Anthropic" or "Local Llama".' },
      model_family: { type: 'string', description: 'The model family it resolves to, e.g. "claude", "gpt", "llama". Defaults to "claude".' },
    },
    required: ['label'],
    build: (input) => {
      const label = str(input.label, 'New provider').trim()
      const modelFamily = str(input.model_family, 'claude').trim() || 'claude'
      return { relationOps: [{ kind: 'create-provider', label, modelFamily }], summary: `Proposed registering the ${label} model provider; awaiting confirmation.` }
    },
  },
  {
    name: 'create_system_prompt',
    description:
      'Add a reusable system prompt to the library — a named, model-family-tagged prompt an Agent can be built from. Use when the user asks to save or add a system prompt. The user confirms before it is added.',
    properties: {
      label: { type: 'string', description: 'The prompt name, e.g. "Deep research".' },
      body: { type: 'string', description: 'The prompt text the Agent drives the model with.' },
      target_family: { type: 'string', description: 'The model family it was authored for, e.g. "claude". Defaults to "claude".' },
    },
    required: ['label', 'body'],
    build: (input) => {
      const label = str(input.label, 'New prompt').trim()
      const body = str(input.body, 'You are a helpful assistant.')
      const targetFamily = str(input.target_family, 'claude').trim() || 'claude'
      return { relationOps: [{ kind: 'create-prompt', label, body, targetFamily }], summary: `Proposed adding ${label} to the system-prompt library; awaiting confirmation.` }
    },
  },
  {
    name: 'create_agent',
    description:
      'Create a worker Agent — a reusable bundle of a Model provider + a system prompt + instructions that drives conversations. Use when the user asks to create or set up a worker agent. The user confirms before it is created.',
    properties: {
      label: { type: 'string', description: 'The agent name, e.g. "Research scout".' },
      provider: { type: 'string', description: 'The Model provider it runs on, e.g. "Anthropic". Optional — defaults to the account default.' },
      system_prompt: { type: 'string', description: 'The library system prompt it uses, e.g. "Deep research". Optional.' },
      instructions: { type: 'string', description: 'Custom instructions appended after the prompt. Optional.' },
    },
    required: ['label'],
    build: (input, ctx) => {
      const label = str(input.label, 'New agent').trim()
      const provider = byLabel(ctx.commons?.providers, str(input.provider))
      const prompt = byLabel(ctx.commons?.systemPrompts, str(input.system_prompt))
      return {
        relationOps: [
          {
            kind: 'create-agent',
            label,
            providerId: provider?.id,
            providerLabel: provider?.label,
            systemPromptId: prompt?.id,
            systemPromptLabel: prompt?.label,
            instructions: str(input.instructions) || undefined,
          },
        ],
        summary: `Proposed creating the ${label} worker agent${provider ? ` on ${provider.label}` : ''}; awaiting confirmation.`,
      }
    },
  },
  {
    name: 'commission_agent',
    description:
      'Commission a worker Agent onto a shared Project (assign it as a Contributor). Use when the user asks to commission, assign, or add a worker agent to a project. The user confirms before it is commissioned.',
    properties: {
      agent: { type: 'string', description: 'The worker Agent to commission, e.g. "Research scout".' },
      project: { type: 'string', description: 'The Project to commission it onto, e.g. "Insights dashboard".' },
      role: {
        type: 'string',
        description: 'Optional project role (D14): owner, maintainer, writer, or reader. Defaults to writer.',
      },
    },
    required: ['agent', 'project'],
    build: (input, ctx) => {
      const agent = byLabel(ctx.commons?.agents, str(input.agent))
      const p = resolveProject(str(input.project))
      if (!agent) {
        return { summary: `No worker agent matching "${str(input.agent)}" — proposed nothing.` }
      }
      const raw = str(input.role).toLowerCase()
      const role = (PROJECT_ROLES as readonly string[]).includes(raw) ? (raw as ProjectRole) : undefined
      return {
        relationOps: [
          { kind: 'commission-agent', agentId: agent.id, agentLabel: agent.label, projectId: p.id, projectName: p.name, ...(role ? { role } : {}) },
        ],
        summary: `Proposed commissioning ${agent.label} to ${p.name}${role ? ` as ${role}` : ''}; awaiting confirmation.`,
      }
    },
  },
  {
    name: 'uncommission_agent',
    description:
      'Remove a worker Agent (a Contributor) from a Project — un-commission it. Use when the user asks to remove or un-commission an agent from a project. The user confirms before it is removed.',
    properties: {
      agent: { type: 'string', description: 'The worker Agent to remove, e.g. "Research scout".' },
      project: { type: 'string', description: 'The Project to remove it from.' },
    },
    required: ['agent', 'project'],
    build: (input, ctx) => {
      const agent = byLabel(ctx.commons?.agents, str(input.agent))
      const p = resolveProject(str(input.project))
      const commission = agent && (ctx.commons?.commissions ?? []).find((c) => c.agentId === agent.id && c.projectId === p.id)
      if (!agent || !commission) {
        return { summary: `No commission of "${str(input.agent)}" on ${p.name} to remove — proposed nothing.` }
      }
      return { relationOps: [{ kind: 'uncommission-agent', commissionId: commission.id, agentLabel: agent.label, projectId: p.id, projectName: p.name }], summary: `Proposed removing ${agent.label} from ${p.name}; awaiting confirmation.` }
    },
  },
  {
    name: 'handoff_agent',
    description:
      'Hand the current conversation off to a different worker Agent — re-bind which Agent drives this thread (D16). Use when the user asks to hand off, switch, or pass the conversation to another agent. The user confirms before the hand-off.',
    properties: {
      agent: { type: 'string', description: 'The worker Agent to hand off to, e.g. "Research scout".' },
    },
    required: ['agent'],
    build: (input, ctx) => {
      const agent = byLabel(ctx.commons?.agents, str(input.agent))
      if (!agent) {
        return { summary: `No worker agent matching "${str(input.agent)}" — proposed nothing.` }
      }
      return {
        relationOps: [
          { kind: 'handoff-agent', sessionId: ctx.session.id, sessionTitle: ctx.session.title, agentId: agent.id, agentLabel: agent.label },
        ],
        summary: `Proposed handing this conversation to ${agent.label}; awaiting confirmation.`,
      }
    },
  },
  {
    name: 'set_commission_cap',
    description:
      "Set a Project's per-commissioner abuse cap (D13) — the maximum number of active Contributors (Commissions) it admits. Use when the user asks to cap, limit, or set a maximum number of commissions / contributors / agents on a project. The user confirms before it is set.",
    properties: {
      project: { type: 'string', description: 'The Project to cap, e.g. "Insights dashboard".' },
      cap: { type: 'number', description: 'The maximum number of active commissions — a non-negative integer.' },
    },
    required: ['project', 'cap'],
    build: (input) => {
      const p = resolveProject(str(input.project))
      const n = Number(input.cap)
      if (!Number.isInteger(n) || n < 0) {
        return { summary: `"${String(input.cap)}" is not a valid commission cap (a non-negative integer) — proposed nothing.` }
      }
      return {
        relationOps: [{ kind: 'set-commission-cap', projectId: p.id, projectName: p.name, cap: n }],
        summary: `Proposed capping ${p.name} at ${n} commission${n === 1 ? '' : 's'}; awaiting confirmation.`,
      }
    },
  },
]

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/** The Anthropic `tools` array the backend declares in every Messages request —
 *  derived from the catalog so the schema and the executor never drift. */
export const TOOL_DEFINITIONS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: {
    type: 'object' as const,
    properties: t.properties,
    required: t.required,
  },
}))

/** Every tool name, for the mock model + tests. */
export const TOOL_NAMES = TOOLS.map((t) => t.name)

/** Execute one tool call: build its consent-gated proposal (a relation-edit card
 *  or an escalation) and the `tool_result` summary fed back to the model. An
 *  unknown name is reported, not thrown, so a stray call degrades gracefully. */
export function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): ToolEffect {
  const spec = BY_NAME.get(name)
  if (!spec) return { summary: `Unknown tool '${name}' — no effect.` }
  return spec.build(input ?? {}, ctx)
}
