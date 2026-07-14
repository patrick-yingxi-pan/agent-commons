/** ── Contract: the delegated-cognition relay wire (Session providers) ────────
 *  The rendezvous face of a `kind:'session'` Model provider
 *  (docs/delegated-cognition-provider.md): a user-side connector — enlisted next
 *  to an AI session the user already runs — long-polls `GET /relay/poll` with the
 *  one-time rendezvous secret as its bearer credential, receives a turn's prompt,
 *  lets its session's model generate, and posts the answer to `POST /relay/reply`.
 *  These are the only two wire shapes the connector speaks; the UI never does
 *  (it sees only the provider row + the `relay.*` ambient events). */

/** One tool the far session may RELAY a call to (v2 — the framed mailbox,
 *  §10 "structured tool-use"): the Anthropic tool-definition slice, renamed to
 *  the wire's camelCase. The far model never *executes* these — it answers with
 *  `toolCalls` and the platform executes each one into the same consent-gated
 *  proposal a dial-out turn produces (relay-not-execute discipline). */
export interface RelayToolDefinition {
  name: string
  description: string
  /** JSON Schema for the call's input (the Messages API `input_schema` shape). */
  inputSchema: Record<string, unknown>
}

/** One relayed tool call. The `id` is minted server-side when the connector
 *  submits (never trusted from the wire) and keys the eventual result turn. */
export interface RelayToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** The platform's executed result for one relayed call, fed back to the far
 *  session in the follow-up prompt (honest: a proposal is "awaiting the user's
 *  confirmation", never "done"). */
export interface RelayToolResult {
  toolCallId: string
  content: string
}

/** One turn of the prompt document — the role structure survives the relay
 *  (§7.4: a document, not a flattened string). A prose turn carries `text`;
 *  the tool-use loop's continuation turns carry `toolCalls` (the assistant
 *  turn echoing what the far session relayed) and `toolResults` (the user
 *  turn feeding back what the platform executed). Exactly one of the three
 *  is set per turn. */
export interface RelayPromptTurn {
  role: 'user' | 'assistant'
  text?: string
  toolCalls?: RelayToolCall[]
  toolResults?: RelayToolResult[]
}

/** What a pulled prompt looks like: the system framing separate from the turns,
 *  so the connector can render it into the far session with explicit delimiters.
 *  (The far session double-wraps — this `system` arrives as *content* inside a
 *  session that has its own system prompt; an accepted trade-off.) `tools` is
 *  the turn's callable surface (the Agent's allowlist + the session's attached
 *  connectors) — absent only when the turn offers none. */
export interface RelayPrompt {
  system: string
  messages: RelayPromptTurn[]
  tools?: RelayToolDefinition[]
}

/** `GET /relay/poll` resolves with exactly one of:
 *  - a prompt to answer (`entryId` keys the eventual reply — §7.1 anti-poisoning);
 *  - `idle` — the bounded long-poll window elapsed with nothing to do; the
 *    connector must immediately poll again (the §4.2 re-call sentinel);
 *  - `superseded` — a newer poll with the same secret took this parked slot
 *    (newest-wins, §7.3) or the secret was rotated; this loop should stop. */
export type RelayPollResult =
  | { entryId: string; prompt: RelayPrompt }
  | { idle: true }
  | { superseded: true }

/** Body of `POST /relay/reply`. Exactly one of `completion` / `toolCalls` /
 *  `error`: a refusal from the far model is a *completion* (a refusal is a
 *  reply — §7.6); `toolCalls` relays the prompt's tool calls back unexecuted
 *  (the platform executes them and offers a follow-up prompt carrying the
 *  results — one loop iteration per entry); `error` is the connector's own
 *  hard failure (host error, sampling denied), which fails the turn to its
 *  fallback immediately. */
export interface RelayReplyRequest {
  /** The entry this answer settles — from the poll that delivered the prompt.
   *  Anything but the live entry is answered 410 Gone (drop it and poll on). */
  entryId: string
  completion?: string
  /** Relayed calls — ids are server-minted; the connector sends name + input only. */
  toolCalls?: Array<{ name: string; input?: Record<string, unknown> }>
  error?: string
}
