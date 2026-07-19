/** ── Generated API tools for the in-app session (access-parity INV-11) ───────
 *  The third leg's parity, made real: the model serving a conversation is
 *  declared one tool per HTTP operation of this product, GENERATED from the
 *  same catalog the MCP door uses (server/apiSurface.ts) — no second list.
 *  Execution follows the consent model, not the transport:
 *   • a READ (GET) runs immediately through the router — with the SESSION
 *     OWNER's identity, so the model can read exactly what its user can read,
 *     nothing more — and lands as a `done` ToolActivity (the provenance row
 *     under the message);
 *   • a MUTATION never executes here. It becomes a `proposed` ToolActivity
 *     carrying its operation (`op`) and a consent-card family; the server
 *     executes it — through the same router, as the CONFIRMER — only when the
 *     user confirms (routes/index.ts, the tool-activities route).
 *  The purpose-built proposal tools (server/model/tools.ts) remain the
 *  preferred path for the flows they cover — richer cards, name→id edge
 *  resolution; these generated tools are the completeness guarantee.
 *
 *  `MODEL_API_EXCLUDED` is this leg's argued exclusion list (the analog of
 *  `MCP_EXCLUDED`): the conversation plane itself, the identity/credential
 *  plane, and machine self-service edges are not model-proposable — each entry
 *  carries its argument and the parity test locks the bijection. */
import type { ToolActivity, ToolCardFamily } from '../../contract/index.ts'
import { API_BASE_PATH } from '../../contract/index.ts'
import type { ApiOperation } from '../apiSurface.ts'
import { API_BODY_EXAMPLES, pathFor } from '../apiSurface.ts'
import type { InnerResponse } from '../http/dispatch.ts'

export const API_TOOL_PREFIX = 'api__'

/** Routes the in-app model may NOT reach, each with its argument. Keyed
 *  `"METHOD /pattern"`. Three planes:
 *   • the conversation plane — the model IS this plane; driving it would be
 *     recursion or self-consent;
 *   • the identity/credential plane — sign-in, credential minting/rotation and
 *     membership are the user's own acts (a model-proposed credential is the
 *     confused-deputy shape the consent card cannot make legible);
 *   • machine self-service edges — a runner/relay/peer authenticates itself;
 *     these aren't user acts at all.
 *  Streams are excluded for FORM (same argument as the MCP door). */
export const MODEL_API_EXCLUDED: ReadonlyMap<string, string> = new Map([
  // form: streams + the MCP endpoint (a tool call is request/response)
  ['GET /events', 'the ambient SSE stream never ends — state is readable through the list/get tools'],
  ['GET /sessions/:id/turns/:turnId/stream', 'SSE resume of a live turn — the model already receives its turns through the conversation'],
  ['GET /relay/poll', 'the session-relay mailbox long-poll — a machine edge with its own rendezvous credential'],
  ['POST /mcp', 'the MCP endpoint — one non-HTTP door proposing calls to another adds recursion, not capability'],
  ['GET /mcp', 'the MCP endpoint (its server→client stream — the conversation already has one)'],
  ['DELETE /mcp', 'the MCP endpoint (its session teardown — not a workspace operation)'],
  // the conversation plane
  ['POST /sessions/:id/messages', 'the model IS the conversation — sending messages to sessions from inside a turn is recursion, not capability'],
  ['POST /sessions/:id/turns/:turnId/cancel', 'cancelling turns is the viewing user\'s live-turn control, meaningless from inside the turn'],
  ['POST /sessions/:id/tool-activities/:activityId', 'the consent-resolution edge — a model must never confirm or decline its own proposals'],
  ['POST /relations/ops', 'the confirm EXECUTOR for the curated proposal cards — proposals are made through the purpose-built tools; only the user\'s click lands here'],
  // the identity/credential plane
  ['POST /auth/session', 'identity minting — sign-in and account switching are the user\'s own acts'],
  ['DELETE /auth/session', 'sign-out is the user\'s own act'],
  ['DELETE /auth/accounts/:id', 'forgetting a remembered account is the user\'s own act'],
  ['POST /auth/signup', 'account creation is the user\'s own act'],
  ['POST /auth/login', 'credential entry is the user\'s own act — a model never handles a password'],
  ['POST /auth/token', 'minting a bearer credential — credential admin stays a direct user act'],
  ['DELETE /auth/tokens/:id', 'revoking a bearer credential — credential admin stays a direct user act (the metadata LIST stays readable: the model may read what its user may read)'],
  ['POST /orgs', 'founding an organization is an identity-plane act'],
  ['POST /a2a/peers', 'minting a verified peer credential — a model-proposed credential is the confused-deputy shape'],
  ['DELETE /a2a/peers/:id', 'revoking a peer credential — credential admin stays a direct user act'],
  ['POST /providers/:id/rotate', 'rotating a relay rendezvous secret — credential admin stays a direct user act'],
  // machine self-service edges
  ['POST /runners', 'runner enrollment — a runner authenticates itself; not a user act'],
  ['POST /runners/:id/heartbeat', 'runner liveness — machine self-service'],
  ['PATCH /runners/:id/capabilities', 'runner advertisement — machine self-service'],
  ['DELETE /runners/:id', 'runner deregistration — machine self-service'],
  ['POST /runners/:id/sync', 'runner effect reconciliation — machine self-service'],
  ['POST /relay/reply', 'the far model\'s mailbox edge — authenticated by the rendezvous secret, not a user act'],
  ['POST /a2a/projects/:id', 'the foreign-peer JSON-RPC edge — authenticated by the peer\'s own bearer'],
  ['POST /a2a/agents/:id', 'the foreign-peer JSON-RPC edge — authenticated by the peer\'s own bearer'],
])

/** POST tails that carry PROSE the user should review as content, not as a
 *  request shape — comments, proposals, sub-goals, invites. */
const POST_TAILS = new Set(['comments', 'proposals', 'subgoals', 'open-subgoals', 'invites'])

/** POST tails that MINT an entity — the create-card family. */
const CREATE_TAILS = new Set([
  'sessions',
  'orgs',
  'providers',
  'agents',
  'system-prompts',
  'commissions',
  'schedules',
  'dispatch',
  'saved-contexts',
  'import-card',
])

/** The consent-card family for a mutation, chosen mechanically from its shape.
 *  Total over the included surface — locked by `tests/api-tools.test.ts`. */
export function familyFor(op: Pick<ApiOperation, 'method' | 'pattern'>): ToolCardFamily {
  if (op.method === 'PATCH') return 'edit'
  if (op.method === 'DELETE') return 'danger'
  const tail = op.pattern.split('/').filter(Boolean).at(-1) ?? ''
  if (POST_TAILS.has(tail)) return 'post'
  if (CREATE_TAILS.has(tail)) return 'create'
  return 'action'
}

/** The Anthropic tool-definition slice for one generated API tool. */
export interface ApiToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export interface DerivedApiTools {
  definitions: ApiToolDef[]
  /** wire tool name → its operation. */
  byName: Map<string, ApiOperation>
}

/** Derive the model-facing tool set from the operation catalog. Deterministic;
 *  excluded routes contribute nothing. */
export function deriveApiTools(catalog: ApiOperation[]): DerivedApiTools {
  const definitions: ApiToolDef[] = []
  const byName = new Map<string, ApiOperation>()
  for (const op of catalog) {
    if (MODEL_API_EXCLUDED.has(`${op.method} ${op.pattern}`)) continue
    const name = `${API_TOOL_PREFIX}${op.name}`
    const properties: Record<string, unknown> = {}
    for (const p of op.params) properties[p] = { type: 'string', description: `Path parameter :${p} (a concrete id).` }
    properties.query = { type: 'object', description: 'Optional query-string parameters.', additionalProperties: { type: ['string', 'number', 'boolean'] } }
    if (op.method !== 'GET') {
      const example = API_BODY_EXAMPLES.get(`${op.method} ${op.pattern}`)
      properties.body = {
        type: 'object',
        description: 'JSON request body — shapes follow the HTTP contract.',
        // The shared curated example (apiSurface.ts) — same payload the MCP
        // door surfaces, so neither door's model guesses shapes off 400s.
        ...(example !== undefined ? { examples: [example] } : {}),
      }
    }
    const description =
      op.method === 'GET'
        ? `${op.method} ${API_BASE_PATH}${op.pattern} — reads immediately, as the user (they can see what you read).`
        : `${op.method} ${API_BASE_PATH}${op.pattern} — PROPOSES this ${familyFor(op)} to the user; nothing changes until they confirm. Prefer the purpose-built tools when one covers the request.`
    definitions.push({
      name,
      description,
      input_schema: { type: 'object', properties, required: op.params },
    })
    byName.set(name, op)
  }
  return { definitions, byName }
}

/** Reads feed their result to the model; cap it so one broad list can't flood
 *  the far context (the full data remains one tool call away, narrower). */
const MAX_READ_CONTENT = 6_000

/** What the runtime needs to execute a read NOW: dispatch bound to the acting
 *  user's headers (the route builds this closure — server/routes/index.ts). */
export interface ApiToolRuntime {
  catalog: ApiOperation[]
  dispatch: (method: string, path: string, body?: unknown) => Promise<InnerResponse>
}

export interface ApiToolOutcome {
  /** The provenance/consent row for the message (absent on malformed input). */
  activity?: ToolActivity
  /** The tool_result content fed back to the model. */
  content: string
  isError?: boolean
}

/** Append `input.query` to a concrete path. The query rides INSIDE `op.path`
 *  so a confirmed mutation replays exactly what the card displayed. */
function withQuery(path: string, query: unknown): string {
  if (!query || typeof query !== 'object') return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (v !== undefined && v !== null) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** Execute (read) or PROPOSE (mutation) one generated API tool call. Returns
 *  `undefined` when `name` isn't an api__ tool (caller falls through). `id` is
 *  the tool_use id — the stable handle the confirm/decline later addresses. */
export async function runApiTool(
  name: string,
  input: Record<string, unknown>,
  id: string,
  runtime: ApiToolRuntime,
): Promise<ApiToolOutcome | undefined> {
  if (!name.startsWith(API_TOOL_PREFIX)) return undefined
  const { byName } = deriveApiTools(runtime.catalog)
  const op = byName.get(name)
  if (!op) return { content: `Tool '${name}' does not exist on this API.`, isError: true }
  for (const p of op.params) {
    if (typeof input[p] !== 'string' || input[p] === '') {
      return { content: `Missing required path parameter '${p}' — pass a concrete id (read the matching list first).`, isError: true }
    }
  }
  const path = withQuery(pathFor(op, input), input.query)

  if (op.method === 'GET') {
    const out = await runtime.dispatch('GET', path)
    const contentType = out.headers['content-type'] ?? ''
    const text = out.body.toString('utf8')
    let payload: unknown
    if (/^image\//.test(contentType)) {
      payload = `(binary ${contentType.split(';')[0]}, ${out.body.length} bytes — shown to the user, not inlined)`
    } else if (text.length > MAX_READ_CONTENT) {
      payload = `${text.slice(0, MAX_READ_CONTENT)}… (truncated — read a narrower slice for the rest)`
    } else if (contentType.includes('application/json')) {
      // Parsed, not re-quoted: the model reads `{"body":{…}}`, never an
      // escaped-JSON-in-a-string it has to unescape mentally.
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = text
      }
    } else {
      payload = text
    }
    const activity: ToolActivity = {
      id,
      tool: name,
      connector: 'Workspace API',
      connectorId: 'api',
      kind: 'read',
      status: 'done',
      summary: `GET ${API_BASE_PATH}${path} → ${out.status}`,
    }
    return { activity, content: JSON.stringify({ status: out.status, body: payload }), isError: out.status >= 400 }
  }

  // A mutation: propose, never execute. The op the card shows is byte-for-byte
  // what the confirm executes.
  const method = op.method as 'POST' | 'PATCH' | 'DELETE'
  const family = familyFor(op)
  const activity: ToolActivity = {
    id,
    tool: name,
    connector: 'Workspace API',
    connectorId: 'api',
    kind: 'action',
    status: 'proposed',
    family,
    op: { method, path, ...(input.body !== undefined ? { body: input.body } : {}) },
    summary: `Proposed: ${method} ${API_BASE_PATH}${path} — confirm to apply.`,
  }
  return { activity, content: 'Proposed to the user — awaiting their confirmation; not executed yet.' }
}
