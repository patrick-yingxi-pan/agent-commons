# Agent Commons — an agents-collaboration platform

Agent Commons is a multi-account platform where people configure agents, work
through adaptive conversations, and coordinate shared projects. Conversations,
projects, artifacts, contexts, model providers, agents, routines, discussions,
and change proposals are addressable resources in one collaboration workspace.

The repository is a working end-to-end implementation over a deterministic
development backend. The UI, versioned HTTP + SSE contract, authentication and
authorization, MCP doors, model/tool-use seam, persistence, and session-relay
connector are real boundaries. Seeded entities, the local model, and development
connector/MCP discovery + fulfilment are explicit fixtures documented in
[`docs/spec/11-mock-boundary.md`](docs/spec/11-mock-boundary.md); release profiles
fail closed where a real adapter is not configured.

## What the platform supports

- **People and agent workers.** Accounts register providers and system prompts,
  configure agents with bounded authority and budgets, and commission them onto
  shared projects.
- **Adaptive conversations.** A conversation can attach workspaces,
  repositories, files, connectors, and MCP servers. Its tools and context panes
  grow in place without losing the thread.
- **Shared resource coordination.** Projects collect contributors, open work,
  artifacts, contexts, routines, discussions, proposals, and contribution
  history under one canonical resource model.
- **Consent and delegation.** Model-requested mutations become explicit
  confirmation cards. Standing grants, routine approval, principal attribution,
  and audit records make delegated effects inspectable.
- **Equivalent access doors.** The browser UI, a permitted in-session model, and
  an authenticated remote MCP client enter the same route-owned capability and
  authorization surface. See [`docs/mcp-access.md`](docs/mcp-access.md).
- **One split workspace.** Every conversation and resource page is an equal pane
  that can be focused, split, resized, navigated, and closed.

## Architecture

The React frontend does not import backend fixtures. It reads through hooks and
issues commands through controllers against a versioned API. The server owns
state, authorization, persistence, scheduling, model tool execution, and the SSE
event stream. Saved connectors, MCP servers, repositories, and their recent-use
lists are strict viewer-tenant state: routes, search, model/routine resolution,
persistence, and ambient invalidations all project the same partition. Connection
status has its own monotonic revision and an acknowledgement-gated Retry/Dismiss
workflow, so another window cannot silently overwrite a newer auth transition.
Sharing and authored social prose use the same held recovery grammar; social
posts additionally persist an opaque logical identity so a lost response can be
reconciled after restart without publishing the words or notifications twice.
Provider onboarding also owns one durable logical identity: a lost response can
reconcile the exact provider instead of creating another, and the desktop keeps
its provisional OS-vault key until that exact row is acknowledged and bound.
Provider removal pins both definition and connection truth, keeps its page
recoverable through server and device-vault cleanup, and never hides a stale key.
New Agent follows the same truth boundary: its complete configuration stays
visible through Retry/Dismiss, and a tenant-scoped durable identity makes a lost
response recoverable without minting a duplicate worker.
Removing an Agent now previews its proposal/delegation and conversation-fallback
consequences, pins the reviewed definition, and retains the row through recovery.
New Prompt keeps its complete definition and optional default choice under that
same held ceremony; the server commits both together and reconciles by exact
durable identity rather than mutable prose.
Prompt removal now begins on the canonical page, names its library/default and
Agent-dependency scope, pins the reviewed definition, and retains the page until
acknowledgement or exact absence settles it.
Commissioning follows that boundary too: the chosen Agent, Project, and stated
role remain selected through Retry/Dismiss, and a durable Commission identity
turns a lost handoff acknowledgement into one exact Contributor instead of two.
Removal completes that lifecycle with a named consequence preview, revision-
pinned consent, held-row recovery, and an atomic release of its claimed work.
Delegating judgment now keeps the complete Agent, act, autonomy, policy, and
escalation choice visible until durable truth settles it; a lost response
reconciles one exact authority row instead of granting the same policy twice.
Declaring work follows the same rule: its title and summary stay visible before
the Changes ledger until one exact durable Contribution is acknowledged, so a
lost response cannot create a second review record.

```text
contract/   Framework-free wire types and reducers imported verbatim by UI and server
server/     Node HTTP + SSE backend, route catalog, stores, persistence, auth, model seam
src/        React UI, API cache, controllers, projection models, and rendered surfaces
connector/  Session-relay connector served by the product
desktop/    Secure Electron lifecycle and local-backend host
```

The contract is the portability boundary. The same UI can talk to a local
sidecar or a remote server; `GET /v1/capabilities` describes which host-bound
operations are available, and unsupported native operations return
`409 capability_unavailable` rather than being guessed from the environment.

Generation runs through `@anthropic-ai/sdk` and a real, bounded Messages tool-use
loop, including result-dependent follow-up tool batches. `MODEL_MAX_TOOL_ROUNDS`
sets the executed-batch budget (default 4, hard ceiling 8); the first over-budget
request runs nothing and ends visibly.
Development boots an Anthropic-compatible deterministic model server at `:8788`.
Set `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` to
point the same seam at a live provider.

Routine cadence and execution are durable in the desktop process. A fire freezes
its authored definition and endpoint binding, then runs the same guarded Messages
loop under the bound Agent's live authority and budget. Transient failures retry
three times by default with exponential backoff; operators can tune
`ROUTINE_MAX_ATTEMPTS` (1–8) and `ROUTINE_RETRY_BASE_MS` (default 5000).

## Run it

Requires **Node 26+**.

```bash
npm install
npm run dev        # UI 127.0.0.1:5173 + API 127.0.0.1:8787 + mock model :8788
```

The auth gate defaults on. Ada is the flagship demo account:
`ada@acme.example` / `ada-demo-password`. All six accounts are listed in
[`docs/demo-accounts.md`](docs/demo-accounts.md). Use `127.0.0.1`, not
`localhost`, because the remembered account stack is origin-local.

Useful commands:

```bash
npm run dev:ui       # Vite only; expects the backend on :8787
npm run server       # backend only
npm run model        # deterministic model server only
npm run connector    # session-relay connector
npm run desktop:dev  # Electron + Vite HMR + shell-owned local backend
npm run start        # Electron shell over the built UI
npm run start:desktop:server # headless desktop profile (operations/debugging)
npm run start:web    # hosted profile (required env below)
npm run desktop:package # build an unpacked platform application in out/
npm run desktop:smoke   # launch that package with isolated temporary user data
npm run desktop:verify  # package + real native startup/render/storage smoke
npm run desktop:release:mac # signed/notarized direct-download ZIP (credential-gated)
npm run typecheck
npm run build
npm test             # Node behavior and repository locks
npm run e2e          # Playwright browser wiring
npm run ui:sweep     # signed-in surface × viewport review harness
npm run verify       # typecheck + Node suite + build + sharded E2E
```

`npm run dev` and `npm run server` retain the review/demo posture. Release-shaped
boots use explicit profiles:

- `npm run start` (also `start:desktop`) launches the near-term Electron app over
  the built UI. Electron is only a secure host: its sandboxed renderer has no Node
  or direct IPC authority; its narrow preload faces cover OS-encrypted write-only
  provider keys, managed backups, and user-mediated file/folder selection. The picker
  returns bounded preview data but never a path, reusable handle, or generic filesystem
  operation. A supervised utility process runs the existing desktop
  profile on an ephemeral loopback origin. The backend owns native capabilities,
  embedded SQLite, the credential-less device owner, client-asserted identity
  denial, and the exact-origin wall. Database and portable snapshots live under
  the OS-managed Agent Commons user-data directory; an orderly app quit drains
  and checkpoints the backend. If the sandboxed window exits unexpectedly, a
  native prompt reopens its last trusted route without restarting the healthy
  backend, or quits cleanly; saved work remains, while unsaved window text may
  be lost. If the authoritative local service itself exits after startup, one
  native prompt defaults to a clean whole-app restart instead of leaving a stale
  window; an exit before the first window is ready remains solely in startup
  recovery, so the two ceremonies cannot race. A genuinely new database starts clean: no
  fictional conversations, projects, artifacts, routines, accounts, connections,
  or usage history. Release profiles disable the inline mock: without a configured
  endpoint, the composer says so and the API refuses a turn before writing it.
- `npm run desktop:dev` uses the same shell/backend ownership with an isolated
  development user-data directory and Vite HMR. `npm run desktop:package` first
  builds the UI and then creates an ASAR-packaged application in `out/` with the
  current Electron Packager. The Electron archive is verified against the checksum
  shipped in the official npm package, and the embedded macOS icon must byte-match
  the canonical generated Agent Commons icon. Packager 20 may still announce that
  Apple's optional newer `.icon` format is absent before using `.icns`; that probe
  is not suppressed, while the resulting bundle is verified directly.
  `desktop:smoke` launches that exact executable with throwaway user data and proves
  backend readiness, the built UI, and local SQLite placement; `desktop:verify`
  runs both stages. The result is a verified unpacked artifact, intentionally
  unsigned for local development.
- `npm run desktop:release:mac` is the separate fail-closed direct-download
  release path. It accepts only a Developer ID Application identity and a
  `notarytool` Keychain profile; plaintext Apple passwords are not a supported
  input. Electron Packager signs every nested code object with hardened runtime,
  uses a repository-owned least-privilege entitlement for generic app code,
  submits to Apple, and staples the accepted ticket. The orchestrator then
  independently reads and verifies the bundle identifier, display name,
  executable name, versions, and Mach-O architecture before checking the
  signature, ticket, and Gatekeeper verdict. It creates a versioned
  architecture-specific ZIP, extracts that ZIP into a fresh directory, repeats
  the identity and trust checks, and runs the full packaged-app smoke against the
  extracted executable. Only then does it write the adjacent SHA-256 manifest
  and a deterministic machine-readable schema-v2 release receipt that records
  those verified bundle facts alongside the archive name, byte size, digest, and
  completed verification stages. The receipt is publishing/audit metadata, not
  a substitute for the app's Apple code signature or an authenticated download
  channel.
  Configure the machine once with `xcrun notarytool store-credentials`, then run:

  ```bash
  APPLE_SIGNING_IDENTITY='Developer ID Application: … (TEAMID)' \
  APPLE_NOTARY_KEYCHAIN_PROFILE='agent-commons-notary' \
  npm run desktop:release:mac
  ```

  Set `APPLE_KEYCHAIN` only when both the certificate and notary profile live in
  a non-default Keychain. Outputs land in ignored `release/` as
  `Agent-Commons-<version>-macos-<arch>.zip`, its `.sha256`, and
  `Agent-Commons-<version>-macos-<arch>.release.json`. The command builds the host
  architecture (`arm64` or `x64`) and treats each artifact set as immutable: if
  any output already exists, publishing refuses rather than overwrites it. Updater
  policy remains a separate product decision.
- `npm run start:desktop:server` keeps the release-shaped backend available
  without Electron for diagnostics, recovery tooling, and contract-level work.
- `npm run start:web` preserves the later hosted boundary: remote capabilities,
  required sign-in, client-asserted identity disabled, Secure cookies, and SQLite
  by default. It refuses to boot without a 32+ character `AUTH_SECRET` and exact
  HTTPS `CORS_ORIGIN`. The current persistence engine is single-process; a managed
  multi-instance store remains a web-service follow-on.

The initial-world choice applies only to absent storage and is then recorded in
the snapshot. An existing demo database remains a demo database under a release
profile, and an existing clean/user database is never repopulated from fixtures.
To evaluate a clean first run after using the demo, point `DATABASE_PATH` at a new
file (or first preserve the old store with the snapshot tooling below).

For example: `AUTH_SECRET=replace-with-32-plus-random-characters CORS_ORIGIN=https://app.example npm run start:web`.
For remote-capability development without the release checks, use
`BACKEND=remote npm run server`.

In the Electron app, Models → New provider accepts a Messages API URL and an
optional API key. The key is encrypted through the OS account (`safeStorage`) in
the app's user-data directory; Agent Commons' database and HTTP requests retain
only a generated `PROVIDER_DESKTOP_*` reference. The bridge is write-only—there
is no renderer operation to read or list keys. Linux installations without a
real secret store refuse Electron's `basic_text` fallback and use the explicit
environment-reference workflow instead. Provider creation holds the form and
that same provisional reference until the server acknowledges or the client
reconciles the exact durable row; transport uncertainty never deletes a key that
a committed provider may already reference.

On a fresh install, the opening draft detects that no model can answer and offers
one **Connect a model** action. It opens the same Models provider form directly;
after a Messages endpoint is verified, Agent Commons selects it and returns to the
untouched draft ready for the first message. Creating an offline Session provider
does not claim readiness—the session's drain loop still has to connect.

In Add context → Files, Photos, or Folder → This computer, Electron uses the native
OS chooser while the web build retains browser input and drag-and-drop. Both normalize
into the same attachment workflow. Native folder attachment intentionally lists only
top-level regular files and stops after 500 top-level items; large or excessive selections stay in place with a clear
limit message rather than silently truncating or widening filesystem access.

For a provider you created, Models → provider → **Update connection** replaces
only the URL, model, or key you enter. The server merges those write-only fields,
verifies the effective Messages connection before committing it, and leaves the
previous connection intact on failure. A successful desktop key rotation retires
the prior encrypted key; an interrupted post-save bind is repaired on restart.

**Edit provider** is intentionally a separate definition workflow. It sends only
the name, model family, or default choice actually changed and compares the
definition revision the form opened on. A concurrent edit stays visible behind
the held draft with explicit Retry/Dismiss; it cannot overwrite ownership,
transport, model catalog, connection ordering, or live Session-relay state.

Headless desktop operation, recovery, and web deployment can supply the built-in
connection when launching:

```bash
npm run build
ANTHROPIC_BASE_URL=https://api.anthropic.com ANTHROPIC_API_KEY=… npm run start
```

Outside Electron, the Models page registers another Messages-compatible endpoint
using an optional `PROVIDER_*` environment-variable reference: launch the server
with the variable already set, then enter only that variable's name. In both
modes a custom endpoint is probed before it is saved or replaced; endpoint URLs,
credential references, and secret values never appear on the provider read shape.

## Persistence and recovery

JSON is the server-development default. The Electron app selects embedded SQLite
under its OS user-data directory. The headless profile remains useful for an
explicit recovery path:

```bash
npm run build && npm run start              # Electron + OS-managed user data
DATABASE_PATH=/path/to/store.db npm run start:desktop:server
```

Backups are portable across both backends. `save` can run against the selected
live store; stop the server before `restore` so the old process cannot overwrite
the recovered state, then restart it.

On each successful Electron start, Agent Commons best-effort ensures one portable
recovery point for the current UTC day and retains the latest seven automatic copies;
manual backups are never pruned. **Customize → Local backups** reports whether today's
automatic copy was actually confirmed, and a failed check points directly to **Back up
now** instead of implying protection. The same surface creates a timestamped copy,
reveals the OS-managed backup folder, or initiates a native restore.
Restore accepts only a managed backup from that folder and defaults its replacement
warning to Cancel. While healthy, the app first creates a fresh safety copy, proves the
backend stopped, validates and reads back the replacement, then restarts. Startup failure
offers the same restore path but clearly warns that a fresh safety copy is unavailable.
The renderer never receives a filesystem path, file contents, or raw restore primitive.
Backups contain private workspace and account data, but provider API keys remain separate
and are not included or replaced; copy important backups to other protected storage yourself.

```bash
npm run snapshot:save -- before-update
npm run snapshot:list
npm run snapshot:restore -- before-update
```

`SNAPSHOT_DIR` can place exports outside the store directory. Imports are parsed,
forward-migrated, and checked before mutation, then read back from the selected
backend; a restore that cannot be proven fails loudly. An export contains the full
application state (including credential hashes and private content), so keep it in
access-controlled storage.

A live write failure is also loud: the mutation returns `503 storage_unavailable`,
`/readyz` fails, and the process refuses further product traffic until restart. It
does not resume merely because disk access returns—the in-memory graph may have
advanced past the last durable snapshot. `/healthz` and `/metrics` remain available
for the desktop shell or service supervisor to diagnose and restart safely.

Startup distinguishes a genuinely absent store from an unusable existing one. Only
absence creates the seeded baseline; malformed, structurally invalid, unrecognized,
newer, or un-migratable JSON/SQLite storage stops the process before replacement.
An orphan atomic temp, WAL, or journal also counts as recovery data—not absence.
Repair or restore the preserved store explicitly, then restart.

## Stack

- React + TypeScript + Vite, Tailwind CSS v4, Framer Motion, Lucide
- Node 26 + `node:http`
- `@anthropic-ai/sdk` at the replaceable generation boundary
- Framework-free shared contract and dependency-light server modules

## Project layout

```text
contract/   shared API types, entities, reducers, events, and capability vocabulary
server/     backend modules; scoped context, specs, and tests live beside their owners
src/        frontend modules; shared primitives and projection templates live in lib/
docs/       design rationale, operational guides, and the requirements ledger
tests/      repository-owned document and cross-layer locks
e2e/        Playwright tests for rendered browser behavior
scripts/    development, verification, snapshot, and UI-sweep tooling
connector/  session-relay connector
```

Start with [`AGENTS.md`](AGENTS.md) for the progressive-disclosure context map.
The checkable requirements and implementation/lock correlations live in
[`docs/spec/`](docs/spec/README.md); production-oriented architecture decisions
live in [`docs/design/`](docs/design/README.md).
