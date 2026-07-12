# Multi-account UI — detailed design

> **Direction change (2026-07-12) — now EXECUTED:** the workspace-tenancy layer
> this doc built on (multi-workspace accounts, workspace switching, memberships)
> is **collapsed** under the **principals & namespaces** model —
> [`principals-and-namespaces.md`](principals-and-namespaces.md) (INV-10). An
> account holds exactly one namespace; the workspace routes, the wizard's team
> step, and the chip menu's workspace section are gone. The account **stack**
> and the switch-mid-generation machinery (§12, I1–I5) survive unchanged — they
> switch *humans*, not tenants. Read this doc's workspace sections as history.

> **Status: BUILT (P0–P9, 2026-07-04)** — P9 (§13, by user direction) **retired
> the dev switcher directory**: `GET /v1/identities` and the chip menu's
> "Switch identity (dev)" section are gone; seeds carry documented demo
> credentials and go through the same sign-in + account stack as every real
> account (§5.6's directory design is thereby historical).
> P8 (§12) added the **front door**: a
> dedicated full-screen auth flow (GitHub-style sign-in + stepped sign-up
> wizard + account picker, replacing the chip menu's inline forms), the
> **account stack** (a second signed cookie remembering every credentialed
> sign-in, so the switcher hops between accounts instantly), `Identity.via`
> (signed-in as a wire fact), and the `AUTH_GATE=require` production posture.
> P7 (§11) added **real accounts**:
> onboarding (signup/login, scrypt, constant-work failures), workspaces, and a
> persisted account registry replacing the seeded constants.
> Earlier phases: — P5 (build log row 51) revised §5.6 by
> user direction: the switcher is **uniform across backends**, not remote-only.
> Every backend honours the identity seam and advertises a directory; what
> differs is what switches — the web's org principals vs the desktop's
> workspaces (the user is fixed on the desktop; only the tenant moves,
> mirroring the desktop app's personal↔work account menu). **P6 made the feature
> production-ready** (§10 below): identity is now a **server-issued, HMAC-signed
> HttpOnly session cookie** (`POST /v1/auth/session`; the client-asserted
> header/query seam survives only behind `IDENTITY_HEADERS`, denied in the
> production posture), and the two §6.5 deferrals — the **stop button** and the
> **"generation was interrupted — retry"** affordance — are built
> (`src/components/TurnControls.tsx`). Spec rows SYNC-1…6 in
> [`docs/spec/05-portable-contract.md`](../spec/05-portable-contract.md), build log
> rows 46–52 in [`IMPLEMENTATION.md`](IMPLEMENTATION.md), locked by
> `tests/turns|sse-replay|send-idempotency|account-guard|identity-echo|auth-session` +
> `e2e/account-switch.spec.ts` + `e2e/turn-controls.spec.ts`. Settled across a
> design dialogue (2026-07-03); recorded here per the repo rule that decisions
> live in files, not agent memory. Builds on the F2 identity seam
> (`server/identity.ts`, PORT-8) and the P8 cross-tenant cooperation stack
> (COMMONS-6).

## 1. Goal

One browser can act as **multiple accounts (user + tenant identities), one active
at a time**, switched in place from the sidebar account chip — while everything
in-flight for the switched-out account **continues server-side** and its results
**route to the right receiving ends**, so switching back shows a valid, complete,
meaningful state.

### Invariants (each becomes a locking test)

- **I1 — Continuity.** No server-side activity (generation turn, scheduled run,
  runner effect, reservation) pauses, aborts, or is lost because its viewer
  disconnected or switched accounts. Only an *explicit cancel* stops a turn.
- **I2 — Routing.** Every result lands in tenant-scoped state (thread, journal,
  audit, usage) attributed to the correct account, and is pushed only to event
  subscribers whose identity may see it.
- **I3 — No loss.** A client that reconnects either replays the ambient events it
  missed or performs a full resync; there is no silent gap. A dropped reply
  stream never loses the *record* (the persisted message is authoritative).
- **I4 — No duplication.** Retransmission is always safe: ambient events are
  idempotent invalidation hints; mutations dedupe by `Idempotency-Key`; reply
  fragments carry per-turn sequence numbers.
- **I5 — No cross-account contamination.** A response or event issued under
  account A can never be applied to account B's view. (Client generation guard +
  server identity echo.)

## 2. Non-goals

- **Simultaneous accounts side-by-side** in one window. The client keeps one
  active identity; simultaneity remains two browser contexts/profiles (as the
  co-authoring E2E does). Per-message account multiplexing over a shared stream
  is therefore **not** built — the unit of identity stays *the request* (pulls,
  mutations) and *the connection* (streams).
- **Real authentication.** Header-selected identity remains the dev stand-in for
  an auth token (F2). The switcher maps 1:1 onto "which authenticated session's
  token the client presents" in a production build; nothing here bakes in the
  header hack beyond the existing seam.
- Resumable streaming for the *mock model's* upstream call (server↔model). The
  server-side turn is the reliability boundary the UI needs.

## 3. Architecture in one paragraph

The design has four legs, in dependency order. **(A) Turns become server-owned
resources** — a generation runs to completion (or explicit cancel) regardless of
the HTTP connection that started it; the reply stream becomes a *view* that can
detach and reattach. **(B) The ambient event stream becomes resumable** — global
sequence ids + a ring buffer + `Last-Event-ID` replay, with full resync as the
aged-out fallback; events stay *invalidation hints* so duplication is harmless by
construction. **(C) Mutations become retry-safe end-to-end** — the send route
joins the existing idempotency seam. **(D) The client grows an account layer** —
one active identity injected at the two transport seams (`client.ts` fetch
wrapper, `events.ts` stream URL), an account-generation guard that drops stale
responses, and the sidebar chip as the switcher. A switch is: bump generation →
abort local views (not server work) → reset caches → reconnect stream → re-read
the world as the new account. "Frontend is a cache of the backend" is what makes
this cheap: there is no client-owned state to migrate.

## 4. Wire surface (contract/)

All additive; no existing DTO changes shape. New file **`contract/turns.ts`**:

```ts
/** A generation turn in flight on the server (transient; gone once persisted). */
export interface ActiveTurn {
  id: string            // turn id, minted by the server
  sessionId: string
  messageId: string     // the assistant message being built
  seq: number           // highest delta fragment index so far
  startedAt: number
}
```

- `Session` gains `activeTurnId?: string` (projection only; presence = "Claude is
  still writing" even to a client that just arrived).
- `ReplyStreamEvent`'s `message.delta` gains `seq: number` (per-turn, monotonic
  from 1). `message.start` carries `turnId`. Existing consumers ignore both.
- New routes:
  - `GET /v1/sessions/:id/turns/:turnId/stream?after=<seq>` — SSE; replays
    buffered deltas `> after`, then continues live; ends with the same
    `message.end`. `404` once the turn is persisted/gone (client then refetches
    the session — the record supersedes the stream).
  - `POST /v1/sessions/:id/turns/:turnId/cancel` — the *deliberate* stop
    (identity-guarded: session owner only). `204`; the turn persists what it has
    with outcome `aborted`.
  - `GET /v1/identities` — the seeded identities a dev client may act as
    (`{ userId, userLabel, tenantId, tenantLabel, role }[]`). **Remote backend
    only**; native/mock returns `409 capability_unavailable` like other gated
    routes.
- `Capabilities` gains `identitySwitch: boolean` (true only on the remote
  backend) — the UI gates the switcher on this flag, never on env sniffing
  (PORT-3 discipline).
- `GET /v1/events` accepts the standard `Last-Event-ID` header, and identity via
  query (`?user=…&tenant=…`) **on this route only** — `EventSource` cannot set
  headers. The `hello` event gains `resumed: boolean` (replay happened) and
  `seq: number` (the stream's current position).
- **Identity echo:** every response carries `x-resolved-tenant` (and the `hello`
  carries the resolved identity). Pure tripwire — see §6.6.

## 5. Server design

### 5.1 `server/turns.ts` (new) — the turn registry

In-memory, **deliberately not persisted** (same class as reservations and the
runner registry — transient by design; a server restart voids it and the epoch
mechanism resyncs clients).

```
TurnRegistry
  start(sessionId, messageId): ActiveTurn         // one active turn per session
  appendDelta(turnId, text): number               // returns the fragment seq
  attach(turnId, after): { replay: Frame[], live: Subscription } | undefined
  finish(turnId): void                            // persisted; entry removed
  cancel(turnId): AbortSignal-trip                // trips the turn's controller
  bySession(sessionId): ActiveTurn | undefined    // feeds Session.activeTurnId
```

Buffered fragments are `{ seq, text }`. The entry is removed at `finish` — after
that, the persisted message is the authority and reattach 404s into a refetch.
Memory bound: one active turn per session, buffer capped (e.g. 256 KB) with a
`truncated` flag; a reattach past the cap falls back to "wait for
`message.end` / refetch" (the record is never truncated, only the replay).

### 5.2 `server/routes/index.ts` — the send route: detach, don't abort

The one behavioral change that delivers I1:

- **Remove** `req.on('close', () => ac.abort())` (routes/index.ts:1167). The
  existing `SseChannel` already no-ops sends after close; the turn keeps running
  under `generateReply`'s own wall-clock timeout (`server/generate.ts` combines
  signals — the client-abort leg simply disappears; the timeout leg remains, so
  a runaway turn still can't leak).
- Register the turn in the registry at `onStart`; mirror every `onDelta` into it
  (stamping `seq`); `finish` after the persist + `message.end`.
- Completion already routes correctly with **zero new code**: `appendMessage`
  broadcasts `session.updated` (server/store.ts:1471), the events fan-out is
  tenant-filtered at subscribe time (routes/index.ts:1004), and D13/D16 stamping
  already attributes usage/authorship. That is I2 for turns.
- The `AbortController` is now tripped only by: the cancel route, and the
  generation timeout. **Outcome semantics tighten:** `aborted` = deliberate
  cancel; a viewer disconnect no longer touches the outcome (today it's
  conflated — a metrics fix in its own right, PD31).
- The **reattach route** serves `attach(turnId, after)`: replay frames as
  `message.delta` (with their original `seq`s), then live frames, then the
  terminal event. Identity-guarded by the same `denyForeignSession` wall.

### 5.3 `server/eventlog.ts` (new) + `server/http/sse.ts` — resumable ambient stream

- A single **global monotonic sequence** stamped on every broadcast event, and a
  **ring buffer** (size ~512 events / few minutes of chatter) of
  `{ seq, event }`. Global (not per-tenant) sequence keeps shared events simple;
  **visibility is applied at replay time** with the same `eventVisibleToTenant`
  filter the live fan-out uses — replay can never widen visibility (I2).
- `openSse` gains an optional id: `send(event, seq?)` writes `id: <seq>\n` before
  `data:`. Only `/v1/events` uses ids; reply streams use per-turn `seq` in the
  payload instead (different resumption mechanism, §5.2).
- `/v1/events` subscribe logic:
  1. Parse `Last-Event-ID` (header; `EventSource` sends it automatically on
     auto-reconnect).
  2. If present and still inside the buffer → `hello { epoch, seq, resumed: true }`
     then replay `> lastId` (tenant-filtered) then live. **No client cache reset
     needed.**
  3. If absent, aged out, or the epoch changed → `hello { epoch, seq, resumed:
     false }`; the client treats a non-resumed hello on a *re*connection as
     "drop everything and refetch" (`resetAll`). Loss is thereby impossible:
     replayed or fully resynced (I3). Duplication is harmless: events are
     idempotent invalidations (I4).

### 5.4 Send-route idempotency

`POST /sessions/:id/messages` joins the F3 seam, with stream-aware semantics
(the generic `captureResponse` JSON replay doesn't fit an SSE body):

- The client sends `Idempotency-Key` (a per-send UUID minted in `commands.ts`).
- First arrival: key recorded on the registry entry; user turn appended; turn
  starts.
- Retry with the same key **while the turn is live**: do *not* re-append the user
  turn or start a second generation — the response *attaches* to the existing
  turn's stream from `seq 0` (retransmission = reattach; I4).
- Retry after the turn persisted: `409`-free no-op — respond with a terminal
  `message.end` carrying the persisted message (fetched by the recorded
  messageId).

### 5.5 `server/identity.ts` + `server/http/respond.ts`

- `identity()` gains an opt-in query fallback used **only** by the events route
  (`?user=`/`?tenant=`), same resolution rules as the headers. Documented as the
  `EventSource` limitation stand-in; a production build replaces both headers
  and query with the auth cookie/token, which `EventSource` *does* carry.
- Every response gets `x-resolved-tenant` (one line in the shared responder;
  `BASE_HEADERS`' CORS expose-list gains it). The `hello` event includes the
  resolved `{ userId, tenantId }`.

### 5.6 `GET /v1/identities` + capabilities

Remote-mode only. Returns the seeded users/tenants (`server/data/` seeds — the
same set `identity()` resolves against). The capability flag `identitySwitch`
gates both the route and the UI affordance. **Deliberately not a user registry
API** — it enumerates what the dev identity seam already accepts, nothing more.

### 5.7 Mock model: a slow beat for tests

`server/model/` gains one keyword intent (e.g. the message contains
"paced"/"slowly") that streams its canned deltas with a short delay between
fragments (~150 ms, env-tunable). Needed so tests and the E2E can deterministically
switch accounts *mid-generation*. Dev-mock-only; no contract change.

## 6. Client design (src/)

### 6.1 `src/api/account.ts` (new) — the account store

```ts
interface Account { userId: string; tenantId: string }
activeAccount(): Account | null          // null = no override (today's behavior)
accountGeneration(): number              // bumped on every switch
switchAccount(next: Account | null): void
useAccount(): Account | null             // useSyncExternalStore, for the chip
onAccountSwitch(cb): Unsubscribe         // events.ts + controller hook in
```

Persisted to `localStorage` (`account.active`) so a reload stays who you were.
`switchAccount` is the **single choreography point**: bump generation → notify
subscribers (events.ts closes + reopens the stream with the new identity;
controllers drop in-flight local views) → `resetAll()` → the world re-reads as
the new account.

### 6.2 `src/api/client.ts` — identity + generation guard

`request()` (the one door — PORT-2) gains two lines of policy:

- Attach `x-user-id`/`x-tenant-id` from `activeAccount()` when set.
- Capture `accountGeneration()` before `fetch`; on resolve, if the generation
  moved, throw `AccountSwitchedError` (callers treat it as silent abandonment —
  the cache's own per-entry `gen` guard already refuses stale applications, and
  `resetAll` must bump those entry generations so cleared entries can't be
  resurrected by a late resolution — a one-line audit of `cache.ts`).
- **Identity echo assertion (I5):** compare `x-resolved-tenant` against the
  active account's tenant; on mismatch, drop the response and `console.error` —
  a routing bug becomes loud and local instead of silent contamination.

### 6.3 `src/api/events.ts` — resumable, identity-bound stream

- Build the `EventSource` URL with the active account's query identity.
- Track `e.lastEventId` (native). On `hello`: `resumed: false` **and** we had a
  prior connection → `resetAll()` (covers both epoch change — already handled —
  and aged-out replay). `resumed: true` → nothing to do; the replayed events
  invalidate whatever moved.
- Subscribe to `onAccountSwitch`: close, clear `lastEventId`/`knownEpoch`,
  reopen as the new identity. (A *reconnect* keeps `lastEventId`; a *switch*
  discards it — different identity, different visible stream.)

### 6.4 `src/api/commands.ts` — idempotent send + reattach

- `sendMessage` mints an `Idempotency-Key` per logical send and passes the
  account headers (it uses raw `fetch` for the streamed POST — it joins the same
  header/generation policy as `client.ts`, via a small shared helper so the
  policy isn't duplicated).
- New `reattachTurn(sessionId, turnId, after, handlers)` — fetch-streamed GET of
  the reattach route (fetch streams *can* set headers; only `EventSource`
  can't), dispatching through the existing `SendHandlers`. Delta `seq` dedupes
  overlap at the boundary fragment.

### 6.5 Controller + thread view — the pending turn is server state

- On opening a session (or on `session.updated`), if `session.activeTurnId` is
  set and no local stream is attached → show the streaming indicator and
  `reattachTurn(…, after: <highest seq applied locally, else 0>)`.
- The stop button calls the cancel route (deliberate abort), no longer just
  aborting the local fetch — aligning the UI's semantics with the server's
  outcome split.
- A session whose last message is a user turn with **no** active turn (server
  restarted mid-generation, or turn errored while detached) renders a quiet
  "generation was interrupted — retry" affordance; retry is a fresh send. This
  is the one place the failure matrix (§7) surfaces to the user.

### 6.6 `src/components/Sidebar.tsx` — the chip becomes the switcher

The account chip (already the `/v1/me` surface) becomes a menu when
`capabilities.identitySwitch`: lists `GET /v1/identities`, marks the active one,
picks call `switchAccount`. Dismissal via `useDismissable` (the shared hook —
design invariant), menu styling via the existing shared primitives. On the
native/mock backend the flag is false and the chip stays exactly as today.

## 7. Failure matrix

| Failure | Behavior (by design) |
|---|---|
| Viewer disconnects / switches mid-turn | Turn continues (I1); reply persists; `session.updated` routes to the tenant's subscribers; on return, reattach or refetch shows it. |
| Explicit cancel | Turn stops, partial persists, outcome `aborted`. |
| Server restarts mid-turn | Registry (transient) is void; user turn persisted, reply absent; epoch change → client `resetAll`; thread shows the retry affordance (§6.5). Accepted loss — the mock has no turn-resume, and the *record* never lies. |
| SSE drops, reconnects within buffer | Native `Last-Event-ID` → replay; no reset, no loss. |
| SSE drops, reconnects past buffer / after restart | `hello { resumed: false }` → `resetAll` → full resync. |
| Send request lost / retried | Same `Idempotency-Key` → attach to the live turn or replay the persisted result; never a duplicate user turn or double generation. |
| Response lands after account switch | Client generation guard drops it; cache entry `gen` refuses stale application; identity echo catches anything that slips past. |
| Identity-routing bug on the server | `x-resolved-tenant` mismatch → response dropped loudly client-side (I5 tripwire). |

## 8. Phasing & test plan

Each phase lands independently green (typecheck + `node --test` + e2e), with its
spec rows added to `docs/spec/05-portable-contract.md` (new **SYNC-1…4** rows
under the PORT table) and the switcher row noted against PORT-8's identity seam.

- **P0 — server-owned turns.** `server/turns.ts`, detach-don't-abort, cancel +
  reattach routes, `Session.activeTurnId`, delta `seq`, slow-beat intent.
  *Tests:* `tests/turns.test.ts` (registry: buffer/seq/attach/cap),
  `tests/routes-turns.test.ts` (disconnect mid-turn → completes + persists +
  `session.updated`; cancel → `aborted` + partial persist; reattach replays
  `after` correctly; foreign-tenant reattach/cancel 404; post-persist reattach
  404). Outcome-metric split locked in `tests/generation-outcome.test.ts`.
- **P1 — resumable events.** `server/eventlog.ts`, SSE `id:`, `Last-Event-ID`
  replay, `hello.resumed`. *Tests:* `tests/sse-replay.test.ts` (replay window,
  aged-out → resumed:false, tenant filter applied to replay, duplication
  harmlessness), client router reset rule in `tests/` events-router coverage.
- **P2 — idempotent send.** Registry-keyed dedupe + attach-on-retry +
  post-persist replay. *Tests:* extend `tests/idempotency.test.ts` +
  `tests/routes-turns.test.ts` (retry never double-appends; mid-turn retry
  attaches; post-turn retry returns the persisted message).
- **P3 — client account layer + identity surface.** `account.ts`, header/query
  injection, generation guard, identity echo, `/v1/identities`, capability flag.
  *Tests:* `tests/identities-route.test.ts` (remote-only, 409 on native; echo
  header on every responder incl. SSE hello); client-side guard logic factored
  pure and unit-tested (`tests/account-guard.test.ts`); contract boundaries
  extended for the new DTOs/events.
- **P4 — switcher UI + E2E.** Sidebar chip menu; pending-turn/reattach UI; stop
  button → cancel route. *E2E* (`e2e/account-switch.spec.ts`, on the existing
  5183/5184 harness): tenant A starts a **paced** turn → switch to B mid-stream
  (B sees none of A's sessions, chip shows B) → switch back → the completed
  reply is present and the thread is coherent; second beat: kill/reopen the
  events stream and assert replayed invalidation (a schedule fired while
  detached appears without reload).

Rough size: P0 is the bulk (~1 route + 1 module + surgical send-route edit);
P1–P3 are each small and independent; P4 is UI + one spec file.

## 9. Production mapping (so this isn't demo plumbing)

- P0–P2 are exactly what a production client needs for **flaky networks, page
  reloads, and laptop lids** — they are account-agnostic reliability work.
- The account layer (P3) maps onto real auth by replacing "headers/query from
  `activeAccount()`" with "credential of the selected authenticated session";
  the generation guard, echo tripwire, reset choreography, and switcher UI carry
  over unchanged.
- The explicit non-goal (per-message multiplexing) is a real position: identity
  per request/connection is the boundary auth systems already enforce; a shared
  multiplexed stream would move tenant isolation from the transport into every
  consumer — strictly worse. If simultaneous accounts are ever wanted, open one
  `/v1/events` per account (H2 makes idle SSE cheap) and key the cache by
  account; that decision is deferred, not half-made.

## 10. Production posture (P6 — built)

What §9 promised, delivered — and what a deployment must still bring:

- **Verified identity.** `POST /v1/auth/session` validates a pick against the
  identity directory and sets an HttpOnly, SameSite=Lax cookie carrying an
  HMAC-signed token (`server/auth.ts`); resolution is **cookie-first**
  (`server/identity.ts`), role always from the directory (a credential can't
  self-elevate), and the legacy header/query seam is honoured only while
  `IDENTITY_HEADERS` ≠ `deny`. The cookie choice is load-bearing: it rides
  fetch, `EventSource`, **and** `<img>` byte requests automatically — closing
  the two asymmetries the header seam had. The switcher mints the session
  FIRST, then bumps the generation / re-binds the stream / resets the cache, so
  everything that reopens already rides the new identity; a failed mint changes
  nothing.
- **Production knobs (env):** `AUTH_SECRET` (required in production — the dev
  default is deliberately named unusable), `AUTH_SESSION_TTL_S`,
  `IDENTITY_HEADERS=deny` (refuse client-asserted identity),
  `CORS_ORIGIN=<app origin>` (credentialed CORS needs a pinned origin +
  `Allow-Credentials`; the dev default stays `*` behind the same-origin proxy).
- **What a real deployment replaces, not removes:** `signSession` gives way to
  the IdP's verified token (PD8) — `verifySession` becomes a public-key check
  and `/v1/auth/session` becomes the IdP callback; the resolution order, the
  echo tripwire, the generation fence, and the switcher choreography carry over
  unchanged.
- **Turn affordances (§6.5) complete.** The stop button cancels the SERVER-owned
  turn (partial persists; the stream's own `message.end` stands the UI down) and
  the interrupted-retry affordance surfaces an orphaned turn as a quiet inline
  notice + fresh send — one shared component (`src/components/TurnControls.tsx`)
  so the two states can't drift apart visually.
- **Deployment constraint — single process.** The turn registry
  (`server/turns.ts`), the ambient event ring (`server/eventlog.ts`), and the
  SSE fan-out are **per-process, in-memory** — correct on one instance, which is
  this prototype's honest boundary (same class as the mock model). Scaling
  horizontally needs sticky sessions (simplest) or shared pub/sub + a shared
  turn/event store (Redis-class). Recorded as a constraint rather than faked
  with a second in-process abstraction.

## 11. Real accounts (P7 — built)

P6 made the credential real; P7 made the accounts behind it real. The seeded
directory became the **account registry** (`server/accounts.ts`): users,
tenants/workspaces, and memberships as store-owned entities — seeds are now just
rows marked `seeded` — persisted as additive snapshot slices (scrypt credential
included) so onboarded accounts survive restarts.

- **Onboarding**: `POST /v1/auth/signup` (name/email/password → user + personal
  workspace, scrypt per-user salt, auto sign-in on the P6 cookie) and
  `POST /v1/auth/login`. Login failure is **uniform in body AND timing** — an
  unknown email burns the same scrypt as a wrong password (the equalized 401
  would otherwise fall to a timing oracle). Passwords are bounded 8–128 (scrypt
  cost scales with input; unbounded length is a CPU-burn vector, not security).
- **Workspaces**: `POST /v1/workspaces` + `GET /v1/me/workspaces`; the
  `/auth/session` mint gained a second path — re-mint into any tenant the caller
  holds a REAL membership in (a foreign workspace refuses, so workspaces aren't
  enumerable-by-switching). `/v1/identities` stays seeds-only: real accounts are
  never enumerable — they sign in.
- **Resolution tightened**: cookie claims resolve strictly against the registry
  (user must exist, membership must hold); a stale credential resolves to
  NOTHING and falls through. The dev header seam keeps its historical looseness
  on purpose — that looseness is exactly what `IDENTITY_HEADERS=deny` turns off.
- **UI**: the chip menu (`AccountMenu.tsx`) — your workspaces (re-mint picks),
  the dev seed directory (self-rows elided), inline sign-in / create-account /
  new-workspace forms, sign out. One reload edge is load-bearing and locked:
  after a reload the in-memory pick is null while the cookie carries the
  identity, so sign-out must bypass the same-account no-op (`refreshAccount`) —
  the SERVER session changed even though the client's belief didn't.
- **Named follow-ons (not half-built)**: org invites / joining another user's
  workspace, email verification (also the mitigation for signup's inherent
  409-reveals-existence tradeoff), password reset. An IdP deployment replaces
  the credential endpoints; the registry is what carries over.

## 12. The front door: full-screen auth flow + the account stack (P8 — built)

P7 built real accounts but left onboarding living in a sidebar popover — a
cramped inline form inside the product frame. P8 gives auth a **dedicated,
GitHub-style surface** and makes "multiple accounts on one browser" real
(instant switching, not re-typing passwords).

- **The full-screen auth surface** (`src/components/auth/AuthScreen.tsx`)
  REPLACES the workspace frame while open — App.tsx renders one surface or the
  other, never a dialog over the product. Three views, navigable in place
  (view state in `src/controller/useAuthScreen.ts`, an external store so any
  component can open it without prop-drilling): **Sign in** (email/password),
  **Create account** — a stepped wizard (details → password with a live rule
  checklist mirroring the server's 8–128 bound → workspace, with an optional
  team-workspace input) that submits ONE atomic signup at the end (abandoning
  mid-wizard creates nothing), and **Choose an account** — the remembered-
  accounts picker. The wizard's step machine + password rules + shared form
  primitives are framework-free (`src/lib/authFlow.ts`) so `node --test` locks
  them; the sidebar menu's one remaining inline form (New workspace — no
  identity transition) wears the same primitives (form follows function).
- **The account stack** — GitHub-style multi-account. A SECOND signed HttpOnly
  cookie (`uw_accounts`, `server/auth.ts`) remembers every account that
  **signed in with a credential** on this browser (seed/dev picks never join),
  in **SIGN-IN ORDER, stable** (2026-07: a re-sign-in or switch refreshes the
  entry IN PLACE — the switcher's rows never shuffle under the pointer; a new
  account appends; the cap evicts the oldest sign-in), deduped by user, capped
  (`STACK_MAX`), per-entry TTL. Each entry records the account's
  **last-active tenant**, refreshed on every mint, so a switch back lands
  where the account left off. New surface:
  - `GET /v1/auth/accounts` → `AuthAccount[]` — the stack resolved STRICTLY
    against the registry at read time (deleted user drops; a revoked
    last-active membership falls back to the account's first workspace);
    `current` marks the active session's account. Never enumerates anything
    the cookie doesn't already prove signed in here.
  - `POST /v1/auth/session { userId }` — the third mint path: a bare userId
    the verified stack remembers re-mints the ACTIVE session **without a
    credential** (the stack cookie is the proof of prior sign-in; the registry
    still validates the landing tenant). Unknown/unstacked userIds refuse.
  - `DELETE /v1/auth/session` now also forgets the ACTIVE account's stack
    entry (sign out of one account; the others stay — the client then offers
    them on the picker); `?all=1` forgets everything.
  - `DELETE /v1/auth/accounts/:id` (2026-07) forgets ONE remembered account —
    the switcher rows' HOVER sign-out; forgetting the active account also
    clears the session (a remembered-list can't outlive the session proving
    it). Idempotent; the stack cookie itself is the authorization. In the
    menu this replaced the old "Account" section: sign-out lives on each row,
    and "Add account…" is the menu's last line.
- **Signed-in is now a wire fact**: `Identity.via: 'session' | 'headers' |
  'default'` stamps HOW the identity resolved. Only `'session'` reads as
  signed in — the auth gate and the account menu branch on it, never on
  heuristics. (The default principal still answers ungated requests; that's
  the demo posture, below.)
- **The auth gate** (`AUTH_GATE` → `capabilities.features.authGate`): the
  production posture — the workspace never renders for an unverified identity;
  App.tsx shows the auth surface (picker → sign-in fallthrough) with the
  back-to-workspace escape withheld. **Hardened 2026-07 into a server-side
  WALL** (the follow-on this bullet used to name is built): with the gate on,
  an anonymous request resolves to the ANONYMOUS principal (`/me` and the
  identity echo name nobody — never the backend default) and every data route
  401s it through one router middleware; only the front door and the
  self-authenticated machine edges (A2A, relay, the connector download) stay
  open. Real boots (`dev`/`server`/`start`) default the gate ON
  (`server/index.ts`; `AUTH_GATE=off` opts out — the E2E stack does), so
  pre-sign-in nobody's data is served OR rendered; the auth flow itself exists
  either way (chip menu → Sign in / Create account / Add account, and sign-out
  lands on the picker). Locked by `tests/auth-gate.test.ts`.
- **Menu → switcher completion**: the chip menu grew an **Accounts** section
  (the stack, instant hops via the bare-userId mint) + "Add account…" (opens
  the full-screen sign-in titled "Add another account" — the current account
  stays signed in). The inline sign-in/sign-up forms are GONE from the menu
  (they open the dedicated surface); sign-out is shown only when
  `via === 'session'`.
- **One remount edge, fixed and locked**: the auth surface swapping the
  workspace out and back remounts it, so the intro overlay's state lifted to
  the App shell — "Add account…" mid-session must not replay the intro
  (`e2e/auth-wizard.spec.ts` exercises the round-trip; the overlay check rides
  the onboarding spec's flow).
- **Locked by**: `tests/auth-stack.test.ts` (cookie primitives: round-trip,
  tamper→[], per-entry expiry, dedupe/cap), `tests/auth-accounts.test.ts`
  (stack over the wire: join on signup/login, strict resolution, hop-back
  lands on last-active tenant, credential-less mint refused without the stack,
  sign-out forgets one/all, seed picks never join, `via` on the wire, the
  `authGate` flag), `tests/auth-flow.test.ts` (wizard step machine, password
  checklist, server-mirror of the email shape, the shared-primitive lock),
  `e2e/onboarding.spec.ts` (rewritten against the wizard) +
  `e2e/auth-wizard.spec.ts` (two accounts stack → instant hops → sign-out →
  picker → hop back).

## 13. The dev directory retires (P9 — built)

P8 made the mature path exist; P9 (by user direction) removed the immature one
instead of keeping both. The reasoning: the seeded enumeration switcher
("Switch identity (dev)", `GET /v1/identities`) was the *precursor* of real
multi-account — once instant, credential-less switching exists for real
accounts, a parallel directory that mints seeds by name is redundant surface
area and a standing temptation to demo the wrong path.

- **Removed**: the `/v1/identities` route (`404` now — locked as a tombstone on
  both backends), `listSeedIdentities`/`listIdentities`, the SEED mint path on
  `POST /v1/auth/session` (two paths remain: workspace membership re-mint +
  account-stack pick), the `IdentitySummary` DTO, `useIdentities`, and the chip
  menu's dev section. **No backend enumerates identities anymore** — the P7
  promise ("real accounts are never enumerable") now holds for every account.
- **Replaced by**: the seeded web principals carry **demo credentials** —
  `ada@acme.example` / `ada-demo-password`, `grace@acme.example` /
  `grace-demo-password` (documented in AGENTS.md; hashes are precomputed
  constants with fixed salts so neither boot nor the test suite pays scrypt for
  them). The multi-tenancy demo is now the REAL flow: sign in as Ada, add
  Grace, hop through the stack; Grace reaches `tenant-beta` via her own
  workspace memberships. The desktop `user-local` deliberately keeps NO
  credential — the device owner never signs in; personal↔work switching rides
  the membership re-mint, as before.
- **Migrated, not deleted**: the identity-echo / stream-identity / fan-out
  coverage that shared the old test file moved to `tests/identity-echo.test.ts`;
  `e2e/account-switch.spec.ts` drives the stack rows (`page.request` sign-ins
  share the browser context's cookie jar, so setup is API-fast and the
  UI-driven switching stays the surface under test).
- **Explicitly unchanged**: the request-level HEADER seam (`x-user-id`/…,
  `IDENTITY_HEADERS=deny`) — that's the co-authoring E2E's and the route
  suites' identity *injection* device, a different mechanism from the retired
  UI *enumeration*; it was already production-gated and stays so.
