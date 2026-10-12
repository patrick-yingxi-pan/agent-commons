# Outbound MCP connection work

The product's inbound MCP door is described in [mcp-access.md](mcp-access.md).
This document covers the separate client boundary for user-added external MCP
servers. The interactive connect → inspect → attach → approve → execute workflow
now has a real bounded HTTP adapter. Interactive calls require fresh owner
approval; tool names and annotations never waive it. Unattended Routine calls
instead require the separate bounded MODEL-40 permission, never inherited from
an attached context or Commission.
Public issuer/system-browser OAuth acceptance, local transport integration,
broader input modes, standing trust and real third-party acceptance remain required.
Routine OAuth now has a separately attributed bounded approval path with local
browser and unsigned arm64 packaged acceptance; the production plan records the
exact fixture boundary and remaining release gates.
Other release connector adapters remain
`unconfigured`; this MCP path cannot borrow development fixture capabilities.

## Approved desktop OAuth direction and preparation

On 2026-10-10 the owner approved system-browser sign-in, connection-specific
scope review, OS-protected token custody, refresh within the existing grant and
unchanged tool-call consent. Local fixtures are authorized; real services are not.

The native preparation modules implement bounded metadata admission,
standards-ordered well-known URL candidates, S256 code/state preparation, exact
issuer validation, a one-use ephemeral IPv4 callback and bounded token/refresh
form validation. These preparation modules are now connected through the native
composition described below. HTTPS syntax checks are not
DNS/SSRF admission; the native HTTP layer below separately enforces the shared
pinned-address policy. Callback loopback does not authorize connecting to a loopback MCP server.
Browser responses contain only fixed text, never a code, token or remote error.

Native custody now extends the existing encrypted vault with typed OAuth entries.
The owner, endpoint binding, issuer, token endpoint, client, resource and granted
scopes remain inside ciphertext. Resource identity must equal the canonical
audience of the bound MCP endpoint, not merely another valid HTTPS URL.
The old bearer read refuses OAuth; startup
reconciliation and removal validate both types without exposing credentials.
The shared 64-entry cap remains; each ciphertext is bounded to 128 KiB of base64
text to accommodate two 8 KiB tokens, escaped metadata and OS-encryption overhead.
The outer vault format stays v1; OAuth's encrypted payload uses a closed v2 shape.

The internal refresh manager uses the current token when its expiry is unknown,
without inventing a lifetime or refreshing on an unconfirmed expiration. Known
expiry permits one refresh of the existing grant, never a tool replay. A durable
reservation removes both old tokens from the saved entry before exchange. Only
the live native ticket can publish the complete replacement; an uncompleted
reservation after restart, host cancellation or uncertain exchange requires
sign-in. A known replacement already atomically published remains durable even
if its caller subsequently becomes stale, but that caller receives no token.
Token response scopes may narrow but
never expand the stored ceiling. A response that omits a replacement refresh
token retains the previous token only after validated atomic publication.

Refresh is coalesced by exact credential/owner/binding with eight default active
operations (internal ceiling 64), at most 64 retained waiter subscriptions, and a 30-second default
deadline (internal ceiling 60 seconds). Timed-out/cancelled underlying work keeps
its slot until settlement. A canceled waiter also retains its subscription slot
until the shared promise settles, bounding repeated cancel/rejoin loops.
Each waiter checks its own account/revision fence;
canceling a waiter does not cancel another waiter's shared refresh. Host cancellation
and shutdown abort the transaction. Authority is checked after waits, immediately
before dispatch, and immediately before credential-file rename. Local disk tests
prove the lifecycle with fixture encryption/exchange, not real Keychain OAuth or
provider acceptance. The separate packaged composition below supplies local
OS-storage and runtime evidence, not public-provider acceptance.

Native HTTP preparation now shares `server/outboundAddressCore.mjs` and
`server/mcpProtocolCore.mjs` with the backend's typed facades. Every operation
admits only public HTTPS, checks all of at most 64 DNS answers, pins the chosen
address into the socket, and retains the original certificate hostname and
explicit TLS verification. No private-network option, custom headers, ambient
cookies/proxy agent, redirects, compression or request retry is exposed.
Metadata GETs and exact public-client form POSTs accept at most 64 KiB of strict
UTF-8 JSON (depth 16, 4,096 nodes); headers are capped at 16 KiB. Each request has
a 10-second default deadline including DNS and body, with bounded 1–60,000 ms
internal overrides. Eight default operation slots (ceiling 64) include timed-out
DNS until it settles and destroyed sockets until their close event. Fixed errors
carry conservative submission uncertainty, never request/response secrets.

Resource discovery starts with a credential-free, read-only `server/discover`
probe using the same protocol metadata as the backend. Only parsed 401 Bearer
hints leave that probe; its body is discarded. Authentication challenges support
combined schemes, quoted commas/escapes, whitespace around equals and bounded
empty list members, within 8 KiB, 16 challenges and 32 parameters per challenge.
Ambiguous hints refuse. An advertised `resource_metadata` URL takes precedence;
otherwise the standard path-specific and origin well-known locations are tried.
Only 404/410 advances a candidate, never TLS/DNS failure, redirection, malformed
metadata or identity mismatch. The original resource and exact selected issuer
are validated independently. Challenge scopes and supported scopes remain
separate review hints, not requested scopes or consent.

Resource and selected-server discovery are separate bounded 30-second stages
(internal ceiling 60 seconds), permitting an issuer choice between them without
giving each fallback a fresh deadline. A stage performs at most three requests;
server discovery never fetches an unadvertised issuer or registers a client.
It retains a frozen bounded RFC metadata document inside the native flow so PKCE
setup revalidates the same facts. Future IPC must expose only selected review
fields, not that raw document. Local real-TLS tests compose discovery → PKCE →
one code exchange and vault reservation → refresh/rotation/uncertainty. Test-only
DNS/socket routing and a private fixture CA keep all traffic local; these are
not system-browser, Keychain OAuth, signed-package or live-service acceptance.

Native client registration and a complete internal sign-in transaction now
compose these modules. Registration selects an exact-issuer pre-registered ID,
then a configured HTTPS Client ID Metadata Document when supported, then an
advertised dynamic-registration endpoint. No URL is invented and no failure
triggers a fallback or retry. Operator configuration is bounded to 64 distinct
issuers; public-native clients use no client secret or initial access token.
Dynamic registration sends one closed JSON request and requires HTTP 201 plus
the actual registered redirect, native/public method and exact planned code/
refresh grant types. Unrelated management credentials are discarded. An
unavailable registration method requires an explicitly configured client ID.

The callback binds first so registration uses its actual ephemeral port. A
monotonic deadline covers asynchronous preparation and the callback, including
synchronous work that delays timer delivery. The native transaction permits
eight active operations by default (ceiling 64), one per connection, and keeps
abort-ignoring dependencies counted until settlement. Its three-minute ceiling
covers registration, browser handoff, callback, one token exchange and custody.
Cancellation closes the loopback receiver promptly, but keeps the connection
slot until any already-started registration preparation settles; a late response
cannot open the browser, exchange a code or save credentials.
Initial credential writes recheck the native account/revision fence when queued,
after encryption and before atomic rename. Stale unacknowledged references are
discarded; failed cleanup leaves an encrypted orphan for startup reconciliation.

The internal result contains only a provisional reference, issuer, granted
scopes and known/unknown expiry. Product inspection/acknowledgement is still
required. A real local TLS composition test registers the actual callback,
uses PKCE/state, exchanges once and reopens encrypted custody; the provider page
and OS browser launch are fixtures, and encryption is test-only. This is not
system-browser, Keychain OAuth or packaged product acceptance. The browser owns
its own DNS/TLS/navigation; native URL syntax admission does not pin its sockets.
Under the owner's 2026-10-11 delegation, OAuth connections are person-owned,
including within shared workspaces. Other people sign into their own accounts.
Existing unauthenticated/bearer connections retain their original tenant model;
they never acquire a guessed owner. A Routine may use a person's OAuth grant
only with a separate, bounded Routine MCP approval attributable to that person.
Sign-in, scope review and attachment alone never grant tool-call permission.

The backend distinguishes `device-oauth`, stamps the real authenticated owner
at creation, retains owner-bound deletion receipts, and hides reads, lifecycle
operations and live/replayed invalidation events from other people. Account
membership is rechecked after credential waits and before publication. OAuth
inspection and bound execution use a dedicated resolver carrying person,
endpoint, connection revision and a live fence; bearer resolution cannot be a
fallback. The optional OAuth capability remains absent until an explicitly
configured resolver and startup custody synchronization are available. The
native host now configures it after secure storage is available. Interactive
turns and Contribution envelopes retain private person-bound proposal and receipt
authority. Contribution Project approval stays separate from each explicit Run;
the connection's person must still have current membership and Project authority.
Current ledger/acknowledgement projections expose only Run availability, never
private owner IDs. Shared readers keep arguments and results. Exact owner replay
after disconnect is receipt-only; JSON/SQLite join historical proposals and
attempts to retained connection ownership without guessed migration. Routine
OAuth now follows the same person boundary: one current grant records its owner
and selected OAuth connection IDs privately, and each Routine needs its own
bounded reviewed approval. Sign-in or attachment grants no unattended authority.
Same-workspace peers see only whether another person's grant is active; they may
revoke or replace it using their own connections, but cannot inspect its catalog
or receipts. Queued runs retain the original person and require current
membership and live approval/connection state before credential resolution and
publication; known results after revocation remain private and are not retried.

Internal native orchestration now composes an asynchronous authenticated source
adapter with discovery, issuer/scope review, sign-in and exact inspection receipt
recovery. `/mcp-connections/:id/oauth-source` is cookie-only authentication
transport consumed by the native adapter, not an MCP tool. An authenticated
owner can also read it over HTTP: the route classification describes its intended
consumer, not exclusive native-process access. Its no-store response contains only
the current owner, audience and compact revision/receipt state. The adapter
refuses source changes before submission and checks fresh receipt truth after it;
neither catalogs nor cookies cross its result boundary. A lost response retains
the same provisional reference and operation identity, never repeats sign-in,
and never deletes a possibly committed credential. Unsubmitted work expires in
three minutes; submitted recovery handles expire after ten minutes without
discarding the credential. Cancellation retains admission until work drains.
The separate owner/revision-bound child credential protocol has bounded active
work, one-use request identities and explicit cancellation. The main/preload/launcher now install these modules behind native storage and
startup synchronization. The UI reviews issuer/scopes explicitly, begins with
unchecked permissions, cancels on account changes, and retains uncertain
inspection handles for same-flow recovery. An excluded disposable-package
fixture exercises actual OS custody and restart with networking/browser handoff
replaced. Its excluded local Messages peer continues through rendered attachment,
a truthful pending proposal and separate Run tool consent. The actual MCP call,
exact private owner and result persist in SQLite across signed-in relaunch;
same-key receipt replay and later Disconnect do not repeat the call. The same
native walk separately exercises Contribution proposal, Project approval and
per-call confirmation, exact owner/result persistence and replay across relaunch;
Disconnect removes its remaining Run availability without erasing the receipt. OAuth token
canaries are checked against model input, public transcript and persisted bytes.
The source ASAR is unchanged. Public-service, actual system-browser, signed and
Intel acceptance remain separate.

The design follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
its [discovery ordering](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
and [registration choices](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration),
with [native-app PKCE and external-browser guidance](https://www.rfc-editor.org/rfc/rfc8252.html),
[refresh response rules](https://www.rfc-editor.org/rfc/rfc6749.html#section-6)
and [refresh-token rotation security](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
Registration follows the [published MCP priority order](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches),
[RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html#section-3.2.1) and the
[Client ID Metadata Document draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document).
Native host transaction/custody wiring, connection review UI, and the packaged
OAuth fixture are one mandatory local acceptance gate. A public client metadata URL remains release configuration,
not permission to invent or publish a domain.

## Implemented transport substrate

`server/mcpHttpTransport.ts` sends one bounded JSON-RPC POST and accepts one
correlated JSON or request-scoped SSE response. `server/outboundAddress.ts`
re-exports the shared policy from `server/outboundAddressCore.mjs`, admitting an
explicit public-HTTPS or exact-literal-loopback scope. Public DNS is
resolved once, every returned address is checked, and the socket is pinned to
the admitted address while TLS retains the original hostname. Private,
link-local, reserved and transition addresses are excluded from public scope.
Arbitrary private-LAN access is not granted.
Certificate verification is explicitly required, including when the parent
environment disables Node's default verification.

Endpoints are limited to 2,048 characters; requests to 64 KiB; responses to
1 MiB; SSE events to 256 KiB; response headers to 16 KiB. The 10-second default
deadline includes DNS, connection and streaming (explicit internal overrides
are limited to 1–60,000 ms). Closing or timing out destroys the actual request
and response. Late DNS cannot start a new request. Redirects, environment proxy
agents, ambient cookies, compressed bodies, server-initiated requests and
automatic RPC replay are not supported. Credentials are explicit write-only input;
errors contain fixed codes, not URLs, tokens, response text or raw exceptions.
Request JSON is snapshotted before serialization (depth 40, 8,192 nodes for the
complete RPC envelope), without invoking caller getters or `toJSON` hooks.

After a request is submitted, a transport failure reports `mayHaveExecuted`.
This is conservative uncertainty, not proof of success or failure. The approved
executor durably retains it and never automatically repeats the call. An HTTP
error cannot carry a successful tool result through this seam.
Explicit legacy-session cleanup uses a body-free DELETE to the same validated
endpoint; it cannot follow redirects or expand the destination scope.
Outgoing headers have a combined 32 KiB ceiling, including the explicit bearer;
mirrored tool parameters have their own 16 KiB aggregate ceiling within it.

Supported legacy request-scoped SSE streams can resume after disconnection or
EOF using at most eight body-free GETs with `Last-Event-ID`. They share the
original deadline, cumulative 1 MiB response budget, admitted DNS address, TLS
hostname, exact endpoint/query, version and explicit bearer. The private session
is unchanged; initialization alone may establish it in its first response.
No GET repeats the original RPC body or starts a new session. Completed replies,
JSON, notifications, DELETE and modern/unversioned requests never resume.
GET refuses redirects, authentication/session errors, unsupported media and
malformed data rather than restarting the tool call.

The parser records only complete-event IDs (including empty-data priming),
inherits IDs across events, and clears the cursor on an empty ID. A complete
ASCII-digit `retry` field updates the backoff immediately, even before a blank
line; absent values default to one second. A peer interval longer than the
remaining deadline is never shortened. IDs are bounded to 1,024 UTF-8 bytes;
HTTP-unsafe or edge-whitespace cursors are refused, never silently rewritten.
Partial EOF events are discarded; malformed UTF-8 is refused. Cancellation
clears backoff and closes an active GET while retaining the original RPC's
execution uncertainty. These are read-only stream recovery requests, not tool
retries or durable restart recovery. This follows the
[legacy transport lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [SSE field rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation);
the [modern transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
does not support GET resumption.

Pure framing/address tests and real loopback HTTP/SSE/TLS tests cover this
substrate. The tests fixture only the remote peer; they do not demonstrate a
user connection, paid provider, third-party account, or completed integration.

## Implemented read-only discovery transaction

`server/mcpDiscovery.ts` inspects a configured endpoint in memory. Current
servers receive `server/discover` and paginated `tools/list` with per-request
metadata and mirrored method/version headers. Legacy-shaped HTTP refusals or an
explicitly advertised compatible version can select initialization-based
2025-11-25, 2025-06-18 or 2025-03-26 behavior. A recognizable modern error cannot
silently downgrade, even if its response id is invalid. Authentication and
network failures never trigger another handshake. Deprecated 2024 HTTP+SSE is
not adopted.

The entire transaction has one 30-second deadline (bounded internal overrides),
eight page attempts, 128 processed tools and a 512 KiB cumulative catalog budget. Duplicate
tools, cursor loops, oversized or malformed pages reject the complete catalog.
Legacy sessions are released after inspection when possible; the result reports
unconfirmed or server-managed cleanup without exposing the session credential.
Cancellation closes active I/O and never starts a later page.

Read-only inspection can renew one expired legacy session. An HTTP 404 for a
`tools/list` request carrying the initialized session ID retires that private
credential; the replacement `initialize` sends no old ID. Its catalog starts
at page one, discarding the old catalog and cursors. The original deadline,
page-attempt count (including the failed page), processed-tool count and catalog
bytes remain cumulative. Only the replacement credential can be cleaned up.
Stateless 404s, recognizable modern errors, authentication/network failures,
cancellation and exhausted budgets cannot trigger this recovery. A second
expiry fails without another handshake. Metadata follows the replacement
handshake, while expired, renewing and closed facades cannot issue tool calls.
Real HTTP peers cover bare and correlated legacy 404s; deterministic clock and
state-machine tests lock limits, cancellation and private credential retirement.

`server/mcpCatalog.ts` snapshots and bounds presentation fields and schema JSON
(64 KiB, depth 32, 4,096 nodes per schema). This presentation parser does not
validate dialect semantics or authorize calls; the separate admission phase below
validates schemas. Remote instructions, icons, links,
`$ref` and tool annotations remain inert data. Extra protocol metadata is not
mistaken for an invalid tool definition. Real HTTP peer tests cover both eras.

## Implemented single-call protocol boundary

`server/mcpToolCall.ts` sends exactly one explicit `tools/call` using a supplied
protocol version and, for legacy peers, the surrounding caller-owned initialized
session. It does not reuse discovery's already-released session, initialize a
new one, downgrade, refresh a catalog, replay, or continue an input-required
call. Read-only legacy response resumption is owned by the HTTP transport above.
`server/mcpProtocol.ts` owns the shared versions and request metadata.
Only the separately approved executor below supplies product authority to this
caller; protocol support itself grants none.

The preflight snapshots arguments (48 KiB, depth 32, 4,096 nodes) and the reviewed
schema without invoking getters or serialization hooks. This is structural
admission, **not** semantic input/output schema validation or permission.
`server/mcpHeaderParameters.ts` validates static `properties` paths and derives
modern `Mcp-Name` / `Mcp-Param-*` headers from the actual request body. Header
names are bounded, token-safe and case-insensitively unique; values follow the
protocol's UTF-8/base64 sentinel rules. Non-static annotations, incompatible
primitive values and header-budget overflow fail before network work. `$ref`
is never resolved; data in schema examples/defaults is not treated as a schema.
The separate executable catalog admission phase excludes individually invalid
HTTP tool definitions rather than exposing them as callable tools.

`server/mcpToolResult.ts` snapshots the entire result before interpretation
(1 MiB, depth 32, 16,384 nodes, 128 content blocks). It retains supported text,
image, audio, resource links and embedded resources as inert data, never fetching
links or decoding media into host actions. Structured output may be any JSON
value, including arrays and null. A tool's `isError` remains explicit; malformed
or oversized results never become truncated successes. Modern complete results
require their discriminator. Ordinary product callers refuse `input_required` with a fixed error,
without exposing opaque continuation state or adopting a remote request.

The transport's one deadline covers DNS, sockets and streaming. Cancellation
before submission reports no possible execution; any lost, unsupported, or
malformed reply after submission retains conservative `mayHaveExecuted`.
Even an RPC refusal is not used as permission to replay. Local HTTP/SSE peer
tests prove these protocol properties, not durable receipts, authorization or
third-party acceptance. A transport response that completed before cancellation
is still validated and returned; a late abort cannot erase a known result.

`server/mcpToolSession.ts` now supplies the negotiated lifecycle around one
attempt. It freezes caller intent before network work and uses
`server/mcpSession.ts`, the same negotiation/deadline/cleanup owner as discovery.
The transaction has one 30-second budget (bounded internal overrides) covering
the modern probe, any compatible legacy initialization, the initialized
notification, one tool call, and cleanup. The private legacy credential never
leaves the internal scope, and a closed scope cannot issue another request.
The transaction does not refresh the catalog or infer consent from discovery;
the exact reviewed schema and arguments remain caller prerequisites.

Only the tool transport reports possible execution: a handshake refusal or
tool-DNS cancellation is not an executed tool merely because an earlier probe
was sent. A validated success or `isError` result survives cleanup refusal,
cancellation or deadline expiry with separate cleanup status; cleanup also
preserves a primary error's code and uncertainty. No expired session, header
mismatch or `input_required` response causes a second tool attempt. Read-only
discovery deliberately retains its stricter external-cancellation behavior,
so cancelling inspection during cleanup cannot acknowledge a catalog.

This is not yet a fully conforming legacy client. Closing HTTP does not prove
remote cancellation. Explicit cancellation of a submitted legacy `tools/list`
or `tools/call` now sends one best-effort `notifications/cancelled` POST naming
only that request ID, at the same endpoint with the same negotiated version,
session and explicit bearer. Its independent signal allows delivery after the
operation's signal aborts, but its budget is at most one second and cannot
outlive the original transaction deadline. Expired deadlines start no new
traffic. Neither a notification acknowledgement nor delivery failure changes
the original error or proves the remote operation stopped or had no effect.
Pre-submission refusal, a completed response, initialization, notifications,
DELETE and modern requests never trigger this legacy message. Local peer tests
cover all three legacy versions and stateless legacy servers; the
[legacy cancellation rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
are separate from releasing a session with DELETE.
An aborted transaction sends no later DELETE; server-side session expiry remains
the cleanup fallback, and cancellation delivery is not a session-release receipt.

Read-only catalog renewal above is separate from execution recovery. A later
explicit tool transaction may initialize anew, but this transaction never
replays an uncertain call. Product-owned receipts below now retain execution
uncertainty across restart. These boundaries follow the
[legacy HTTP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and do not themselves authorize product execution.

## Implemented connection lifecycle and native custody

`server/mcpConnections.ts` owns a tenant-scoped private registry and
`server/mcpConnectionInspector.ts` composes exact credential resolution,
bounded discovery, and revision-checked commit. The optional persisted slice
keeps endpoint and opaque credential references private, excludes raw secrets,
and strictly rejects malformed present state; generic Context setup cannot
grant these reserved identities. `desktop/mcpCredentialVault.mjs` and
`desktop/mcpCredentialProtocol.mjs` provide an encrypted vault and bounded
on-demand child channel with exact bindings. Electron opens this separate vault
through secure OS storage; the renderer can provision a token but cannot read,
enumerate, discard, or resolve secrets. The owner-only credential-binding form
returns the exact server audience for that ceremony, with `no-store`; ordinary
connection reads omit both endpoint and credential reference. The renderer
validates the returned connection, tenant and endpoint before native provision.
First-party lifecycle commands and the private binding ceremony carry the frozen
initiating sign-in. Cross-tab cookie drift is refused before reading private
bindings or applying a connection mutation; read-only result reconciliation does
not silently retarget the initiating account. A failed lazy runtime load remains
recoverable and is never cached permanently as a rejected import.

After durable state loads, startup awaits an acknowledged binding sync before
accepting HTTP or creating a renderer window. Initial synchronization errors
refuse startup; intentionally unavailable OS storage instead disables bearer
capability. Later syncs retire only references
removed from the preceding authoritative set, preserving in-flight provisional
credentials. Failed cleanup is explicit and retryable after the product change
has committed; it does not roll back a disconnect or permit the retired token.

Inspection carries one client operation ID and reviewed revision. A private
fingerprint and public receipt survive restart, so exact retries can acknowledge
current truth without another network probe or undoing a later disconnect.
The Contexts detail and conversation preview share the saved catalog, label its
metadata as untrusted, and do not present inspection as live health or consent.
Loopback integration fixtures exercise this composition but are not evidence of
third-party service acceptance. Production network scope remains public HTTPS
pending the owner's desktop loopback-policy decision.

Packaged acceptance uses the real Electron executable and OS-backed safeStorage
in an isolated profile. It proves provision-only IPC, secret exclusion from
ordinary reads/logs/SQLite, and replacement-token binding reconciliation on
relaunch. Obstructing only the test-owned vault filename causes a real atomic
publication failure while SQLite remains writable: disconnect commits, removes
the authoritative credential binding, and reports cleanup pending. Restoring
that filename lets explicit cleanup Retry erase the retired token without
changing the product revision or deleting an unrelated provisional token.
Removal and orphan reconciliation are checked through another full relaunch.
The catalog and replacement binding are seeded into test-owned SQLite while
the app is stopped; this does not prove live replacement inspection, contact an
external server, or demonstrate execution. It runs as part of `desktop:smoke`,
including extracted release candidates; helpers never ship in the artifact.

## Interactive tool approval and execution

Inspection now admits input and optional output schemas through JSON Schema
2020-12 validation. Ajv runs only in a short-lived worker, with 64 KiB/depth
32/4,096-node schemas, 1 MiB/depth 32/16,384-node values, a two-second default
deadline and four live workers maximum. The slot remains held until the worker
actually terminates. Worker memory/code/stack are bounded; environment and
runtime arguments are empty. Values are never coerced, defaulted or mutated;
format is an annotation, not an assertion. Only the default/explicit 2020-12
dialect and its supported vocabularies are admitted. Local references resolve
without network reads, preserving nested resource bases and decoded pointer-token
identity without applying a selected target's relative ID twice. Explicitly
referenced annotation objects receive the same semantic admission as ordinary
schema positions; unreferenced data remains inert. Unresolved references, async extensions and unsupported
required vocabularies fail closed. Remote schema compilation never blocks the
service event loop. These choices follow the [MCP schema requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/index)
and [Ajv's untrusted-schema guidance](https://ajv.js.org/security.html).

Each valid tool receives a code-owned schema-policy hash. Invalid individual
schemas or modern header definitions remain inspectable metadata but are absent
from `executableTools`; cancellation or worker-capacity failure refuses the whole
inspection rather than publishing a partial capability set. Legacy saved
inspections require Refresh catalog to acquire current admission. Disconnected
rows remain visible on existing conversation chips but cannot be newly attached
or contribute tools. Model wire names hash connection ID and raw tool name;
descriptions, labels and annotations cannot alias authority. The combined external
model catalog is bounded to 128 definitions/512 KiB; an oversized set is refused
as a whole with an explicit model-side disclosure.

Both provider transports propose the exact validated arguments. Confirm pins
the containing owner, connection revision, raw tool identity and schema hash,
then durably commits `running` plus its opaque decision receipt before any
credential or network wait. Credentials resolve for one exact private audience;
connection and attachment authority are rechecked after negotiation and after
DNS resolution, directly before the one `tools/call` POST. A changed protocol, catalog, connection or attachment
cannot redirect the approved call. Results are shape- and output-schema-checked,
stored with the activity, and displayed as escaped text/structured JSON. Media
and resource links remain inert descriptors; neither a result nor metadata grants
permission to fetch or execute another resource.

Confirmed success is `done`; a valid tool `isError` is `failed` with its result;
known pre-submission refusal is `failed` without a result. Post-submission failure
or an invalid/unconfirmed result is `uncertain`. All are terminal for that
approval, never a Retry invitation. Exact decision reconciliation can read a
running or terminal receipt without resubmitting the external call. After
compaction, the existing full Session read may reconcile only an exact terminal
external-MCP receipt from the archive; ordinary activity lookup remains active-only,
so archived proposed or running state cannot become a new approval door. Restart
converts interrupted `running` receipts to `uncertain` and saves that recovery
before HTTP admission. A new attempt needs a new proposal and new approval.
The conversation audit distinguishes failed and uncertain effects from success.

An unresolved approval remains part of the execution transaction rather than
ordinary historical prose. A conversation with a running external call cannot
be deleted until that call settles. Compaction refuses proposed or running
external calls both before model work and again at commit, and a fork refuses a
copied prefix containing either state. These walls retain the one actionable
consent card and running receipt; once the activity is terminal, the normal
delete, compaction, and branching workflows are available again.

Later endpoint and Session turns use the same bounded receipt projection instead
of retaining only the assistant's obsolete proposal prose. Identity, lifecycle
and known submission (not sent, result received, or unknown) survive output-budget
omission; omitted content is explicitly unknown. Binary
media and private metadata are not model-history text. Full receipts remain in
the saved conversation and its compaction archive, where terminal receipts retain
exact lost-response acknowledgement and nonterminal rows retain no execution authority.

## Explicit execution scopes

Contribution effects use the exact-bound call engine in
`server/mcpBoundExecution.ts`, separate from conversation attachment authority.
An owner-reviewed binding and separate per-call confirmation precede the durable
reservation and dispatch. Reviewed arguments and results are Project-reader-visible;
connection identity and credentials remain private. Interrupted receipt recovery
never repeats a call. The packaged local-fixture acceptance is recorded in
[`production-plan.md`](production-plan.md); it is not public-service evidence.

Person-owned local stdio Contributions reuse that separate per-call consent, not
conversation attachment authority. The exact connection owner must propose and
run the inspected tool; Project approval alone cannot launch it. An explicit
local-process stamp survives in the approved envelope and every receipt, including
historical versions and removed connections. Private owner/transport joins reject
missing or mismatched provenance. The review discloses normal OS access and
possible effects from starting the program, even before a tool request succeeds.
Launch settings stay in native custody; reviewed arguments and results are shared
with Project readers. Routine stdio remains unavailable. COMMONS-42 tracks this
bounded workflow and its separate acceptance gates.

Routine MCP adds a distinct opt-in permission, not context-level trust. The owner
reviews exact tools, fixed top-level argument values, a per-run attempt cap,
expiry and destination sharing. A queued run retains its original permission;
later approval cannot widen it. Any reserved call prevents automatic prompt
retry. Uncertainty pauses the Routine and revokes permission. Exact receipts
remain owner-only even when output is shared. The owner route is
`/schedules/:id/mcp-permission`; authenticated remote MCP uses the same route,
while in-session mutations remain consent proposals. MODEL-40 tracks the current
integration and its remaining acceptance gates.

## Private interactive follow-up forms

The form-only protocol boundary (`server/mcpFormToolSession.ts`) is enabled only
through the private person-reviewed interactive workflow. Its modern-only session
advertises `elicitation: { form: {} }` on each request, returns a bounded
`input_required` form to the trusted host, and closes without continuing. A
separately invoked continuation snapshots the original tool/arguments, the prior
form, and exact current-round response IDs before negotiation. It sends only the
keyed responses and the unchanged opaque `requestState` (including empty string;
absent stays absent), with a fresh RPC ID. The shared one-attempt latch,
transport deadline, dispatch fence and uncertainty rules still apply. Legacy
fallback is refused before initialization. Discovery/listing cannot return forms.

Admission is intentionally narrow: 1–4 forms, 1–32 flat fields per form and 64
total, at most 64 choices, 64 KiB per request/response snapshot, depth 16 and
8,192 nodes. Opaque state is limited to 8,192 UTF-8 bytes. Only supported primitive
fields and string-enum arrays are admitted; defaults are checked but never
automatically answered. Text is inert, URI validation performs no fetch, unknown
schema keywords/nesting fail closed, and decline/cancel responses carry no content.
Standard result metadata is bounded then discarded, never echoed as state or
interpreted as authority. Optional schema `$schema` and deprecated `enumNames`
remain outside this strict subset; titled `oneOf`/`anyOf` choices are supported.
Format validation uses a conservative ASCII unquoted-email subset and bounded
RFC3339 dates/timestamps without leap seconds; this is not full JSON Schema or
general MCP conformance. URL elicitation, sampling, roots and state-only rounds
remain unsupported. A schema validator cannot detect every request for secrets;
the protocol prohibits form requests for passwords, access/API tokens and payment
credentials. It does not prohibit ordinary contact/profile data categorically.

The product persists private person-bound original-call/round authority, requires
explicit review/edit/Continue or local Stop, keeps answers/state out of shared
history and model input, rechecks membership and exact connection revisions at
dispatch, caps each decision at four rounds and one hour, and recovers interrupted
continuations without automatic replay. Check status is GET-only receipt recovery;
submitted answers are not persisted, only their command hash. Default, legacy,
Routine and Contribution callers remain complete-only. A parsed form is not proof that it came
from this endpoint, tool or person. Sending decline/cancel is itself a new tool
request; abandoning locally must not claim that the server was informed or that
earlier effects rolled back. See the official
[multi-round request](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
and [elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
contracts. JSON/SQLite, five-viewport browser and separate unsigned arm64 packaged
fixtures prove the bounded workflow, not public-service or signed/Intel acceptance.

## Internal local-process foundation

PORT-30 adds native-importable launch admission, JSON framing and process supervision
without wiring a renderer, HTTP endpoint, model executor, startup task or saved grant.
The selected executable, arguments, working directory and explicit environment
are private caller-owned inputs, not MCP-server instructions. No shell or ambient
environment is used. This is not a sandbox or an executable-integrity check:
selected code still runs with the local user's authority.

Four process groups, one pending request each, a 60-second total lifetime and
30-second request deadline bound supervision. Launch data permits 64 arguments,
64 environment entries and 64 KiB aggregate argument/environment bytes. UTF-8
JSON frames are at most 1 MiB including LF, with 8 MiB/1,024 incoming messages,
depth 40 and 32,768 nodes; writes total 2 MiB/128 requests and stderr is drained,
discarded and capped at 1 MiB. Server requests are refused and notifications do
not become host actions. A current-source predicate fences dispatch/publication.
Cancellation is best-effort, then EOF, 250 ms, TERM, 250 ms, KILL; capacity stays
occupied until close. Leader exit triggers one immediate group kill and retires
the numeric group ID; delayed pipe close never signals it again. Escaped
descendants are not contained. Failed calls may already have executed;
the supervisor never automatically restarts a process or replays a request.

The supervisor deliberately does not negotiate a protocol era or attest approved
tool identity. PORT-31 adds the separate internal protocol client below.
User-mediated native configuration, person-owned grants, schema admission, exact
per-call authority and packaged acceptance must compose before users can run a
local server.
Only repository-authored child programs are used by these tests. The framing
and lifecycle follow the official [stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio).

## Internal local-process protocol transactions

`server/mcpStdioClient.ts` requires an injected native owner; it never accepts a
command, working directory, environment, HTTP URL or credential. There is no
default product adapter. Discovery and each explicit ordinary/form call use a
fresh transaction with one shared deadline (30 seconds by default, at most 60).
The modern `server/discover` probe has a two-second default/five-second maximum
budget within that deadline. A valid modern result reuses the process. A generic
RPC error, silence or early close allows one fresh legacy initialization only
after the probe is confirmed closed. Recognized modern errors and unsupported
modern versions never fall back to legacy semantics. Framing, resource-limit,
launch, source and cancellation failures are not downgrade evidence.

Modern requests carry inline protocol/client/capability metadata, not HTTP
headers or session IDs. Legacy initialization advertises no client capabilities
and must return a supported legacy date, tools capability and valid server info
before the initialized notification. Catalogs reuse the same eight-page,
128-tool, 512-KiB budgets and inert tool parser as HTTP. Schemas still need the
isolated semantic admission step before a product integration can use them.

Calls snapshot their complete bounded intent before launch, can pin the reviewed
catalog's protocol, and require a final synchronous exact-true authority check
at the native write. Only the tool request contributes `mayHaveExecuted`;
starting local code can itself have effects. Complete-only callers refuse forms.
Explicit modern form callers reuse the existing private form parser and exact
opaque-state/response echo, returning control between rounds. No callback,
resource URL, server request, advertised instruction or annotation grants host
authority. There is no automatic process restart or tool replay after negotiation.

Close starts native EOF/TERM/KILL cleanup and waits at most one second within
the remaining transaction budget. Unconfirmed close never replenishes native
capacity or permits fallback. Cleanup failure preserves a known tool result or
primary error; a cancelled/stale read-only catalog is not published. This layer
does not implement saved grants, native setup, person binding, receipts or product
activation. Repository-authored subprocess tests exercise both eras and explicit
form rounds; packaged and real-service acceptance remain separate gates.

## Internal native local-process custody

PORT-32 introduces macOS-only `desktop/mcpStdioGrantVault.mjs` and
`desktop/mcpStdioLaunchAuthority.mjs`, not a shipped setup bridge. Exact native
review approval precedes encrypted publication of the detached executable,
arguments, directory and explicit environment. The callback receives native-only
data and must explain unsandboxed execution; real dialog copy and interaction
remain part of the next product milestone. Stored bindings contain tenant,
person and connection IDs, never a fake HTTP endpoint. Opaque `MCP_STDIO_`
references grant no authority without that exact binding and a fresh source
check. No automatic startup, reconnect, tool attempt or replay is installed.

The grant vault caps 64 entries, eight pending mutations, 1 MiB total plaintext
and 2 MiB encrypted file bytes. It requires secure OS storage even when empty,
checks encryption read-back, and never repairs unsafe/corrupt files. Native-only
leases retain immutable launch data and an abort signal; acknowledged discard,
shutdown or unavailable custody invalidate them. One serial disk queue preserves
acknowledgements beyond caller cancellation. If authority disappears before
rename, publication is refused; once durably acknowledged, a provisional
reference is returned for exact recovery even if cancellation arrives meanwhile.
Uncertain post-rename failure disables all leases and requires reopening/recovery,
not a blind write retry. This is not automatic provisional-grant reconciliation.

The launch authority caps four unsettled setup/read operations with a 60-second
review/read deadline. Cancellation returns without freeing ignored work's slot;
custody publication is awaited to preserve its acknowledgement. Each open checks
both fresh source and the native lease after reading custody and again in the
supervisor. Revocation and authority shutdown abort its owned processes; only
physical close releases transport capacity. Saving a launch grant is distinct
from schema admission or consent to a specific tool effect.

`desktop/privateTextFile.mjs` now owns the shared no-follow, strict-UTF-8 private
file comparison and durable replacement also used by folder/Git grants. The
existing effective-user-owned 0700 parent and 0600 file are never repaired.
Parent and file identities, bounded bytes and acknowledged text are rechecked
before publication; the synchronous authority fence follows the final awaited
comparison. External replacement, uncertain publication or failed temporary
cleanup disables the handle. This relies on trusted parent directories,
single-instance ownership and same-user/admin integrity, not process confinement.
The shared helper preserves the prior Windows folder-store policy: it skips
POSIX owner/mode checks and directory fsync there, while retaining regular-file,
identity, bounded-read and CAS checks. It does not add Windows ACL verification;
the new local MCP vault refuses non-macOS targets.

The first product integration was interactive-only (PORT-33). COMMONS-42 adds
separately confirmed person-owned Contribution calls; Routine execution still
requires a distinct policy for local code. Neither workflow inherits ordinary
context attachment as launch consent. Custody unit tests use storage stand-ins;
the separate unsigned arm64 packaged walk uses real encrypted native custody,
an exact fixture-only native approval and repository-authored subprocesses.
Actual native-dialog and third-party-server acceptance remain separate gates.

### Local Routine permission groundwork

The next Routine transport is an explicit person-approved local program, not an
extension of an old HTTP or OAuth grant. Pure policy preparation now requires
`localPrograms: true` and a separately enabled trusted host. Private
`localAuthority` pins the approving person and exact local connection IDs;
OAuth IDs remain independently stamped, and a mixed grant must have one person,
disjoint sets and the existing combined tool bound. Live and retired connection
joins retain transport as well as ownership. Private receipts derive their
`transport: 'stdio'` marker from that frozen authority rather than caller input.

This is internal groundwork only. Product approval/reservation and snapshot
admission still default local programs off. Enabling the workflow requires
person-aware host composition, explicit local-program review, truthful normal-OS
access/startup-effect disclosures, interruption/revoke/restore fencing, and
browser plus packaged acceptance. Existing launch grants cannot silently become
unattended consent, and a pre-tool refusal does not prove an effect-free launch.

## Required next work

- Complete protocol execution: discovery supports the
  [current metadata flow](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
  and [legacy initialization](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
  but is not a complete MCP client. Execution-specific expiry recovery and
  input modes beyond private form elicitation remain. The bounded workflows do not
  replace those requirements or imply general server trust.
- Unattended local transport integration remains separate work; neither OAuth
  setup, Contribution review nor the bounded Routine permission authorizes
  arbitrary tools, local programs or destinations.
- Third-party and combined packaged acceptance of the whole journey, including
  tenant walls, restart, secret exclusion, cancellation and failure recovery.

Per-call approval is the conservative initial workflow, not an inferred owner
decision to trust a server. Any policy waiving that approval still requires an
explicit owner decision. MCP annotations and tool names are never authority.

Network mechanics follow [Node's HTTP request contract](https://nodejs.org/api/http.html#httprequesturl-options-callback).
Address exclusions were checked against the IANA [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)
and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries.
