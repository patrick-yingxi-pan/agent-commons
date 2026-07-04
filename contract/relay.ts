/** ── Contract: the delegated-cognition relay wire (Session providers) ────────
 *  The rendezvous face of a `kind:'session'` Model provider
 *  (docs/delegated-cognition-provider.md): a user-side connector — enlisted next
 *  to an AI session the user already runs — long-polls `GET /relay/poll` with the
 *  one-time rendezvous secret as its bearer credential, receives a turn's prompt,
 *  lets its session's model generate, and posts the answer to `POST /relay/reply`.
 *  These are the only two wire shapes the connector speaks; the UI never does
 *  (it sees only the provider row + the `relay.*` ambient events). */

/** One turn of the prompt document — the role structure survives the relay
 *  (§7.4: a document, not a flattened string). v1 turns are prose-only, so a
 *  turn's content blocks are already plain text. */
export interface RelayPromptTurn {
  role: 'user' | 'assistant'
  text: string
}

/** What a pulled prompt looks like: the system framing separate from the turns,
 *  so the connector can render it into the far session with explicit delimiters.
 *  (The far session double-wraps — this `system` arrives as *content* inside a
 *  session that has its own system prompt; an accepted trade-off.) */
export interface RelayPrompt {
  system: string
  messages: RelayPromptTurn[]
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

/** Body of `POST /relay/reply`. Exactly one of `completion` / `error`:
 *  a refusal from the far model is a *completion* (a refusal is a reply — §7.6);
 *  `error` is the connector's own hard failure (host error, sampling denied),
 *  which fails the turn to its fallback immediately. */
export interface RelayReplyRequest {
  /** The entry this answer settles — from the poll that delivered the prompt.
   *  Anything but the live entry is answered 410 Gone (drop it and poll on). */
  entryId: string
  completion?: string
  error?: string
}
