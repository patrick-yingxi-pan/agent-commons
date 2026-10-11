# Outbound MCP connection work

The product's inbound MCP door is described in [mcp-access.md](mcp-access.md).
This document covers the separate client boundary for user-added external MCP
servers. The interactive connect → inspect → attach → approve → execute workflow
now has a real bounded HTTP adapter. Interactive calls require fresh owner
approval; tool names and annotations never waive it. Unattended Routine calls
instead require the separate bounded MODEL-40 permission, never inherited from
an attached context or Commission.
OAuth, local transports, multi-round input handling, standing trust and real
third-party acceptance remain required. Other release connector adapters remain
`unconfigured`; this MCP path cannot borrow development fixture capabilities.

## Approved desktop OAuth direction and preparation

On 2026-10-10 the owner approved system-browser sign-in, connection-specific
scope review, OS-protected token custody, refresh within the existing grant and
unchanged tool-call consent. Local fixtures are authorized; real services are not.

The native preparation modules implement bounded metadata admission,
standards-ordered well-known URL candidates, S256 code/state preparation, exact
issuer validation, a one-use ephemeral IPv4 callback and bounded token/refresh
form validation. They are not wired to the host yet. HTTPS syntax checks are not
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
provider acceptance. These modules are not connected to Electron's runtime yet.

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
shipping native host does not configure it yet. Interactive/Contribution/Routine
person attribution, native IPC, review/status UI and end-to-end acceptance are
still required; tenant-only callers cannot select OAuth rows in the meantime.

The design follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
its [discovery ordering](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
and [registration choices](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration),
with [native-app PKCE and external-browser guidance](https://www.rfc-editor.org/rfc/rfc8252.html),
[refresh response rules](https://www.rfc-editor.org/rfc/rfc6749.html#section-6)
and [refresh-token rotation security](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
Registration follows the [published MCP priority order](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches),
[RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html#section-3.2.1) and the
[Client ID Metadata Document draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document).
Native host transaction/custody wiring, connection review
UI and real packaged acceptance must compose before OAuth is
advertised as available. A public client metadata URL remains release configuration,
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
require their discriminator. `input_required` is refused with a fixed error,
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

Routine MCP adds a distinct opt-in permission, not context-level trust. The owner
reviews exact tools, fixed top-level argument values, a per-run attempt cap,
expiry and destination sharing. A queued run retains its original permission;
later approval cannot widen it. Any reserved call prevents automatic prompt
retry. Uncertainty pauses the Routine and revokes permission. Exact receipts
remain owner-only even when output is shared. The owner route is
`/schedules/:id/mcp-permission`; authenticated remote MCP uses the same route,
while in-session mutations remain consent proposals. MODEL-40 tracks the current
integration and its remaining acceptance gates.

## Required next work

- Complete protocol execution: discovery supports the
  [current metadata flow](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
  and [legacy initialization](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
  but is not a complete MCP client. Execution-specific expiry recovery and
  multi-round input handling remain. The bounded single-call workflow does not
  replace those requirements or imply general server trust.
- OAuth and local transports remain separate work; the bounded Routine permission
  does not authorize arbitrary tools or destinations.
- Third-party and combined packaged acceptance of the whole journey, including
  tenant walls, restart, secret exclusion, cancellation and failure recovery.

Per-call approval is the conservative initial workflow, not an inferred owner
decision to trust a server. Any policy waiving that approval still requires an
explicit owner decision. MCP annotations and tool names are never authority.

Network mechanics follow [Node's HTTP request contract](https://nodejs.org/api/http.html#httprequesturl-options-callback).
Address exclusions were checked against the IANA [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)
and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries.
