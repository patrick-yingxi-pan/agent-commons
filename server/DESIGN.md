# Backend decision detail — read on demand

This is the detailed rationale behind the compact backend rule index in
[`CLAUDE.md`](CLAUDE.md). It is intentionally read on demand rather than loaded
for every backend edit.

## Context and verification architecture

Each subdirectory is a module that holds everything needed to read, verify and
reuse it: the code, a scoped `CLAUDE.md`, the requirement rows it owns
(`SPEC.md`), and the suites that lock it — as **siblings**, not in a mirrored
tree elsewhere. Progressive disclosure applied to every kind of file, not just
to `CLAUDE.md`: you load a module's context by opening its directory.

| Module | What it owns |
|---|---|
| [`routes/`](routes/CLAUDE.md) | the route table (plain data — the tool surfaces are generated from it) |
| [`store/`](store/CLAUDE.md) | the in-memory store and its tenant-scoped projections |
| [`http/`](http/CLAUDE.md) | transport: router, responses, SSE, non-HTTP door re-entry |
| [`model/`](model/CLAUDE.md) | the Anthropic-compatible mock endpoint (the model seam) |
| [`persistence/`](persistence/CLAUDE.md) · [`SPEC.md`](persistence/SPEC.md) | snapshots, backends, migration, durability |
| [`data/`](data/CLAUDE.md) | seed fixtures and the demo-account data standard |
| [`testkit/`](testkit/CLAUDE.md) | the drivers suites boot the server with |

Root-level modules (`auth.ts`, `accounts.ts`, `mcp.ts`, `relay.ts`, `turns.ts`,
`generate.ts`, …) keep their locks beside them as `<module>.test.ts`. **A suite
belongs to the module it locks, not to the one it drives through**: a test that
exercises auth over HTTP is an auth test and sits next to `auth.ts`; a test
whose subject is an endpoint's contract sits in `routes/`.

Suites are excluded from `tsconfig.json` so colocation does not silently
reverse the measured decision that the test surface is verified by running
rather than by the compiler ([`tests/CLAUDE.md`](../tests/CLAUDE.md)). What
stays in [`tests/`](../tests/CLAUDE.md) is only what the *repo* owns — the
doc-lint and cross-layer locks with no single module to belong to.

## Architecture and contract semantics

- **Few runtime dependencies.** The server uses **`@anthropic-ai/sdk`** at the
  generation seam and the existing **`@zip.js/zip.js`** library solely to write
  bounded generated XLSX/PPTX parts. Reusing its stored-entry writer avoids a second
  archive implementation; it never parses uploads or launches workers. The
  Office input parsers remain renderer-worker-only. **Ajv** is the deliberate
  third dependency: complete JSON Schema 2020-12 semantics are preferable to a
  bespoke partial validator for untrusted external tools. It is imported only
  by a short-lived worker with strict input, memory, concurrency and wall-clock
  bounds; compilation never blocks the service event loop and references never
  fetch network resources. Other server code stays dependency-free, with its
  Node declarations in `server/node.d.ts`.
- **Strict core, convenient edge (INV-9).** An absent request field must mean
  something fixed (inherit / complete-set constant / minimal-risk none), or be
  refused with `ValidationError` → 400 — never resolved to a mutable entity or
  privileged value on the caller's behalf. Conveniences (pre-selections,
  name→id resolution) run at the edge, before the request or consent card, and
  their result is shown. Full statement + earned instances:
  [`docs/spec/09-design-invariants.md`](../docs/spec/09-design-invariants.md).

## Served filesystem boundary

`fs.ts` is shared by the cloud source and mapped development runner roots.
Every handle is an exact, visible, forward-slash relative path: no absolute
paths, dot-prefixed components, empty components, traversal aliases, Windows
drive prefixes, backslashes or control characters. Ordinary spaces, Unicode and
source-qualified `::` names remain unchanged. Descendant symlinks are refused
even when they point inside the root, so listing and direct lookup obey one rule.
Special files, broken links and entries that disappear while scanning are skipped.

Each reader resolves the operator-configured root once, including legitimate
configuration aliases such as macOS `/var`, and pins its directory identity.
A missing or replaced root requires a new reader; a live reader never silently
adopts a replacement tree. Catalog and folder scans return unavailable when the
directory cannot be enumerated; only a successful scan can report an empty
list. A catalog also refuses an unreadable child-folder count rather than
inventing zero. Cloud/runner routes preserve this as 404, and mapped runner
invocations refuse it without journaling success. Optional demo recent-item
seeding may omit unavailable suggestions, but never supplies a live catalog.
Reads use a single no-follow/nonblocking descriptor
where the platform supports those flags, check regular-file identity/version
before and after I/O, and allocate/read no more than the admitted size plus one
byte. Text retains its existing 256 KiB preview and oversize-note behavior; raw
preview/download bodies are at most 32 MiB. Changed, oversized raw or unreadable
files return the existing unavailable/404 result, not partial content. Mapped
runner read/list refusal becomes `capability_unavailable` before a success effect
is journaled; deterministic mock reads remain only for unmapped development runners.

Runner source browsing and mediated invocation share `runnerFs.ts`, one
process-lifetime reader per fixed logical/physical binding. The current runner
snapshot supplies grants on each operation: listing requires `fs.list`, content
requires `fs.read`, and absent/empty/outside-root grants expose no source route.
Narrowing `~/projects` to `~/projects/insights-dashboard` restricts the existing
tree rather than remapping its physical root. Catalogs expose only permitted
entries and list-grant ancestors needed for navigation; folder file counts and
artifacts are filtered, and read grants never imply list grants or vice versa.
Revocation therefore closes a previously known content URL as well as the
source switcher's discovery entry. Cloud storage remains a separately configured
operator-owned source; this does not invent tenant provisioning or runner enrollment.

The `folderSnapshot` capture boundary streams a selected directory,
refusing entry 501 before any file bodies are opened. Hidden files, subfolders,
symlinks and unlisted names count toward that ceiling but do not become input.
Visible regular-file metadata passes through the shared local-folder policy:
lexical ordering, whole strict UTF-8, 64 KiB per file, 128 KiB total and 24
readable files, with explicit omissions for unsupported, oversized, exhausted
or unreadable bodies. Failed enumeration/metadata admission and changed
directory identity/version refuse the batch instead of fabricating emptiness.
Runner capture applies list grants before metadata/body-budget selection and
independent read grants before each descriptor read; after asynchronous policy
completion both the base reader and the facade recheck represented names and
readable bodies through one predicate. A grant may narrow between those await
continuations even when some other list/read scope remains. The facade never
accepts caller predicates as a way to widen grants. The runner object is the
caller's authority snapshot, so the store also re-resolves current registry
authority before publishing or committing an awaited capture. This is not an atomic
point-in-time image of all file contents: each body has its own checked read.
Explicit `GET /fs/folder-snapshot` intake produces a closed folder value.
`POST /sessions/:id/folders/:folderId/refresh` requires current ownership,
exact folder binding and snapshot compare-and-swap; the committed snapshot ID
is its durable replay receipt. Workspace folders own saved bodies once; artifacts
and model attachments are projections. Legacy listings grant no automatic read.

These are application-level defenses, not an OS filesystem sandbox. The
configured directories and their ancestry must be controlled by the operator,
not a hostile local process that can race directory renames, mount filesystems
or create hard links. Filesystem syscalls remain synchronous; ordinary catalog
and metadata scans still have no directory-cardinality ceiling, and none of
these operations has a slow-filesystem deadline. Hosted per-tenant root
provisioning and stronger OS-level isolation remain separate production work;
this checkpoint grants neither local picker nor model-input authority.
Node's [filesystem API](https://nodejs.org/api/fs.html) specifies the descriptor
and open-flag behavior; the colocated confinement/bounds suites exercise actual
temporary files and controlled syscall-time changes.

## Model boundary — explicit provider APIs and shared tools

(Not an in-process fake.) `server/generate.ts` selects an explicit configured
endpoint adapter: Anthropic Messages via `@anthropic-ai/sdk`, or native OpenAI
Responses. DeepSeek uses its official Anthropic-compatible URL preset and the
Messages adapter. Provider-native tool calls are normalized at the wire edge;
the backend runs the shared bounded tool-use loop, executing each declared call
through `server/toolExecution.ts`, returning the provider's tool result, and
continuing or streaming final prose. Endpoint and Session-provider transports
share the executed-batch budget; an over-budget request executes nothing and
ends explicitly. Resource changes remain model tool calls surfaced as
consent-gated proposals the UI confirms (`message.relations` for relation edits,
`message.escalation` for panel escalations), not a backend keyword overlay.
OpenAI Responses preserves provider-managed reasoning items opaquely across
tool continuations and disables server-side response storage. All adapters,
including tool-free generation used by configured Agents, retain the shared
usage, cancellation, and execution policy. `server/model/` remains the dev mock:
it decides tools through deterministic intent matching and canned replies while
speaking the Anthropic Messages wire format. The seeded OpenAI catalog entry is
also a deterministic fixture, not an authenticated OpenAI connection. Provider
setup stores protocol and connection state separately; fixture coverage is not
live-provider acceptance. This follows the project's broader rule: build
replaceable boundaries now (the frontend is a cache of the backend; the backend
is a client of the model; the model manipulates resources through tools), not
prototype shortcuts a production system would have to unwind.

## Authentication and deployment profiles

Development and direct server boots default the auth gate ON
(`server/index.ts` sets `AUTH_GATE ??= 'require'`): pre-sign-in,
the UI shows the auth surface and the API refuses data routes with 401 — the
gate is a server-side WALL (one router middleware + the ANONYMOUS principal in
`store.identity`), not client chrome. The open set is only the front door
(`/capabilities`, `/me`, `/auth/*`, ops probes) and the self-authenticated
machine edges (`/a2a/*`, `/relay/*`, `/connector`). `AUTH_GATE=off` opts a
boot out (the E2E stack and `scripts/ui-sweep.mjs`'s target may run either
way — the sweep signs in as Ada first). Locked by `server/routes/auth-gate.test.ts`;
spec row SYNC-8.

Release-shaped boots resolve before any server module evaluates
(`server/runtimeProfile.ts` → `scripts/start.mjs`). The desktop-first profile
binds only `127.0.0.1`, selects native capabilities + SQLite, denies asserted
identity, and lands as the credential-less device owner; it generates an
ephemeral HMAC secret when none is configured. The later hosted profile keeps
the tenant/auth wall, remote capabilities, and Secure cookies, and refuses to
boot without a strong secret and exact HTTPS app origin. Both profiles pin
`CORS_ORIGIN`; `server/http/origin.ts` enforces it on all socket, preflight, and
router-reentry traffic. This is a DNS-rebinding boundary for a local sidecar,
not merely a response header. Native clients and machine callers send no
`Origin` and remain valid. Spec row PORT-10.

Both release profiles request `INITIAL_WORLD=clean`, but only genuine persistence
absence consumes that input. The resulting snapshot stamps its world mode and
every restart obeys the stored value instead of today's environment. Development
therefore retains the deterministic proposal showcase; a new desktop/web install
contains only essential provider/prompt/Agent infrastructure (plus the desktop's
device principal; hosted remains anonymous until signup); and neither historical
demo databases nor user databases can be reinterpreted by changing a launch flag.
Spec row PERSIST-8.

## Capability parity — three access doors, one wall

The product is reachable by the browser UI, the in-app session, and the **MCP
door** (`POST /mcp`, `server/mcp.ts`) — equally capable, gated by the same
policies, **by construction**. The route table owns whether an operation is an
authenticated product capability, protocol/credential form, semantic alias,
or session-intrinsic realization. Both MCP catalogs project that metadata and
re-enter the router (`server/http/dispatch.ts`); the cross-layer lock derives
the shipped UI's reachable API calls and compares all three semantic capability
sets in both directions. The in-app leg (`server/model/apiTools.ts`, MODEL-25):
reads run NOW as the sending user (provenance rows); mutations become
family-carded proposals executed as the CONFIRMER on the user's click. Never
hand-add a generated tool, create a private exclusion list, or give an access
method a private policy branch. Auth is the one session credential over cookie
OR `Authorization: Bearer` (`transport: 'bearer'` on login/signup mints for
machines).
Explainer: [`docs/mcp-access.md`](../docs/mcp-access.md); locks:
`tests/access-surface-parity.test.ts`, `server/mcp-parity.test.ts`,
`server/model/api-tools.test.ts`, `server/mcp.test.ts`,
`server/routes/auth-bearer.test.ts`.

**The hand-written seam** (owner directive, 2026-08-09: *"always update the MCP
interface of this website to keep the UI and MCP in sync"*). Generation keeps
the TOOLS in sync for free; the door's `initialize` **instructions** are prose,
and they point a machine caller at places in the human UI ("mint a token in
Contexts → …"). That makes MCP a consumer of UI copy with no compiler behind
it: rename the panel and the door keeps directing callers to a screen that no
longer says that — which happened on 2026-08-09, with every suite green. So
every UI string the door quotes is declared in `MCP_UI_COPY` and scanned
against the live components by `server/mcp-ui-sync.test.ts`. Quoting more UI copy
means adding an entry, never another bare literal. Note what the rule does NOT
ask for: a UI change that adds no route needs no new tool — parity is about
capability and policy, not about minting an endpoint per affordance (the rail's
"Your profile" door composes `get_me` → `get_directory_owners_by_name`, and a
second address for that profile would be the drift, not the fix).

## Durable state — persistence and snapshots

When the real server runs (`dev` / `start` / `server`), the UI-owned state —
sent messages, created sessions, attached context + its panels, schedules,
recents, relation edits, and the Agent Commons registries — is snapshotted to
`.data/store.json` on each mutation and rehydrated on boot
(`server/persistence/persist.ts`), so it survives a restart. The simplest viable format
(one JSON snapshot, atomic write). Transient state (reservations, the live
agent registry) is deliberately *not* persisted. Tests run in-memory.

Back up / restore for testing (`scripts/snapshot.ts`): `npm run snapshot:save`
copies the live store to `.data/snapshots/backup.json`;
`npm run snapshot:restore` copies it back (restart the server — persistence
loads once on boot); `npm run snapshot:list` shows them. `npm run snapshot:build`
manufactures a clean, **comprehensive** playground exercising every persisted
slice once — it re-seeds from the `server/data/` fixtures and drives the real
store mutators + relation reducer (so it can't drift from the contract and
reproduces identically in any clone), then writes
`.data/snapshots/comprehensive.json` (`--activate` makes it the live store,
backing up the current one first). The `.json` outputs are gitignored; only the
generator is checked in. `server/persistence/snapshot.test.ts` locks the round-trip and the
every-slice coverage invariant.

## Declared mock operations — seed data and demo accounts

Seed fixtures live in `server/data/` (sessions, projects, artifacts, repos,
diffs, terminal output). Six demo accounts, each a distinct themed world —
roster + credentials in [`docs/demo-accounts.md`](../docs/demo-accounts.md),
data standard locked by `server/data/demo-accounts.test.ts`. The untagged flagship
seeds belong to the backend default AND Ada/Acme (one seat, two faces); the
desktop's local user has no credential on purpose (it never signs in).
