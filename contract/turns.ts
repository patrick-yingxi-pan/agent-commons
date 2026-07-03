/** ── Server-owned generation turns ──────────────────────────────────────────
 *  A generation turn is a server resource, not a property of the HTTP connection
 *  that started it (docs/design/multi-account-ui.md §5.1–5.2, invariant I1): the
 *  reply stream is a *view* that can detach (viewer disconnects, account switch)
 *  and reattach, while the turn runs to completion — or explicit cancel — on the
 *  server. `Session.activeTurnId` surfaces a live turn to any client that reads
 *  the session; the reattach route replays buffered frames `after` a sequence
 *  number, so retransmission can never duplicate applied text (invariant I4). */

/** A generation turn in flight on the server. Transient by design — like a
 *  reservation, it exists only while the turn runs; once the assistant message
 *  is persisted the turn is gone and the message is the authority (a reattach
 *  then 404s and the client refetches the session). */
export interface ActiveTurn {
  /** Turn id, minted by the server (`turn-…`). */
  id: string
  sessionId: string
  /** The assistant message being built ('' until the model's message_start). */
  messageId: string
  /** Highest frame sequence buffered so far — a reattach with `?after=<seq>`
   *  replays everything later than this point. */
  seq: number
  startedAt: number
}
