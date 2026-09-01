<!-- context-schema: v1 -->
# src/api/ — backend-door module index

## Scope

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`contract/CLAUDE.md`](../../contract/CLAUDE.md) for wire types,
[`../controller/CLAUDE.md`](../controller/CLAUDE.md) for command sequences, and
[`docs/mcp-access.md`](../../docs/mcp-access.md) for reachability parity.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| API-A1 | architecture | Hooks are the component read door and command senders are the controller write door. | [`hooks.ts`](hooks.ts) · [`commands.ts`](commands.ts) | [`../../tests/contract-boundaries.test.ts`](../../tests/contract-boundaries.test.ts) | refines UI-A1 |
| API-D1 | data-access | Cache and events project server-owned truth; the client invents no entities. | [`cache.ts`](cache.ts) · [`events.ts`](events.ts) | [`connectivity-freshness.test.ts`](connectivity-freshness.test.ts) | refines UI-D1 |
| API-D2 | data-access | Every UI operation uses a declared `paths.*` builder visible to the parity scanner. | [`keys.ts`](keys.ts) · [`hooks.ts`](hooks.ts) · [`commands.ts`](commands.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines UI-D2; requires API-A1 |
| API-D3 | data-access | Relation edits publish only acknowledged server snapshots; one logical retry carries one idempotency header, monotonic revisions prevent an older full response from rewinding a newer projection, and every server event has a producer and consumer. | [`client.ts`](client.ts) · [`commands.ts`](commands.ts) · [`relationRevision.ts`](relationRevision.ts) · [`events.ts`](events.ts) | [`relation-command.test.ts`](relation-command.test.ts) · [`relation-revision.test.ts`](relation-revision.test.ts) · [`../controller/relation-mutations.test.ts`](../controller/relation-mutations.test.ts) · [`../../tests/contract-boundaries.test.ts`](../../tests/contract-boundaries.test.ts) | requires API-D1; refines ROOT-A1 |
| API-D4 | data-access | Browser session reads share one bounded message-page budget; older continuations belong to the conversation controller and never replace the newest by-id cache projection. | [`sessionPaging.ts`](sessionPaging.ts) · [`commands.ts`](commands.ts) · [`hooks.ts`](hooks.ts) | [`../controller/conversation-store.test.ts`](../controller/conversation-store.test.ts) · [`../../e2e/history-pagination.spec.ts`](../../e2e/history-pagination.spec.ts) | refines UI-E6; requires API-A1 |
| API-D5 | data-access | Ambient sync is live only after the stream's identity-validated, continuity-checked hello; any stream error remains recovering across reconnect construction until the next hello. | [`syncHealth.ts`](syncHealth.ts) · [`events.ts`](events.ts) · [`hooks.ts`](hooks.ts) | [`sync-health.test.ts`](sync-health.test.ts) · [`connectivity-freshness.test.ts`](connectivity-freshness.test.ts) · [`../../e2e/sync-health.spec.ts`](../../e2e/sync-health.spec.ts) | refines API-D1; requires API-D3 |
| API-D6 | data-access | Identity and capabilities form one first-paint barrier: partial answers select no product surface, a failed missing answer is retryable, retry invalidates the complete pair, and only cache-owned answers survive refetch—an explicit identity/epoch reset preserves no ad-hoc identity snapshot, while identity-stable authorization widening revalidates every live query in place. | [`appBootstrap.ts`](appBootstrap.ts) · [`cache.ts`](cache.ts) · [`hooks.ts`](hooks.ts) · [`../App.tsx`](../App.tsx) | [`app-bootstrap.test.ts`](app-bootstrap.test.ts) · [`cache-refresh.test.ts`](cache-refresh.test.ts) · [`../../e2e/bootstrap-recovery.spec.ts`](../../e2e/bootstrap-recovery.spec.ts) · [`../../e2e/orgs.spec.ts`](../../e2e/orgs.spec.ts) | refines API-D1; requires API-A1 |
| API-D7 | data-access | An addressed resource becomes missing only from a successful complete registry read or an explicit existence-hiding 404. Pending reads remain loading, every other failed deciding read remains retryable, and cache-retained resources keep rendering. | [`resourceRead.ts`](resourceRead.ts) · [`cache.ts`](cache.ts) · [`../components/ResourcePage.tsx`](../components/ResourcePage.tsx) | [`resource-read.test.ts`](resource-read.test.ts) · [`../lib/page-grammar.test.ts`](../lib/page-grammar.test.ts) · [`../../e2e/project-page.spec.ts`](../../e2e/project-page.spec.ts) | refines API-D1; requires API-D6 |
| API-D8 | data-access | One logical send owns one idempotency key across transport retry, and finite reply SSE succeeds only on `message.end`; socket EOF is a retryable interruption. | [`commands.ts`](commands.ts) · [`replyStream.ts`](replyStream.ts) | [`reply-stream.test.ts`](reply-stream.test.ts) · [`../controller/conversation-store.test.ts`](../controller/conversation-store.test.ts) · [`../../e2e/turn-controls.spec.ts`](../../e2e/turn-controls.spec.ts) | refines API-A1; requires API-D3 |
| API-D9 | data-access | Viewer session preferences mutate through their own declared path; the shared session PATCH never carries presentation chrome. | [`keys.ts`](keys.ts) · [`commands.ts`](commands.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) · [`../../server/routes/session-preferences.test.ts`](../../server/routes/session-preferences.test.ts) | refines API-D2; requires CONTRACT-D4 |
| API-D10 | data-access | Session context binding operations and the complete workspace cross one declared atomic mutation path; acknowledgement refreshes both context and session projections. | [`keys.ts`](keys.ts) · [`commands.ts`](commands.ts) · [`events.ts`](events.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) · [`../../server/routes/session-contexts.test.ts`](../../server/routes/session-contexts.test.ts) | refines API-D2; requires CONTRACT-D5 |
| API-D11 | data-access | Conversation metadata sends the revision read by the controller and publishes only acknowledged row fields into list/detail caches; the shared monotonic entity fence prevents an older or unrevisioned acknowledgement replay from rewinding newer truth, and clear semantics never leave a stale model binding behind. | [`commands.ts`](commands.ts) · [`entityRevision.ts`](entityRevision.ts) | [`entity-revision.test.ts`](entity-revision.test.ts) · [`../controller/session-metadata-mutations.test.ts`](../controller/session-metadata-mutations.test.ts) · [`../../server/routes/sessions.test.ts`](../../server/routes/sessions.test.ts) | refines API-D1; requires CONTRACT-D7 |
| API-D12 | data-access | Routine definition edits send the revision read by the controller and publish only acknowledged definition fields; the shared monotonic entity fence rejects older acknowledgements while independently moving run history stays intact. | [`commands.ts`](commands.ts) · [`entityRevision.ts`](entityRevision.ts) · [`scheduleRevision.ts`](scheduleRevision.ts) | [`entity-revision.test.ts`](entity-revision.test.ts) · [`schedule-revision.test.ts`](schedule-revision.test.ts) · [`../../server/routes/schedules.test.ts`](../../server/routes/schedules.test.ts) | refines API-D1; requires CONTRACT-D8 |
| API-D13 | data-access | Artifact body edits send the revision read by the controller and publish only the addressed acknowledgement; per-body monotonic merge prevents older full-library reads or legacy acknowledgements from rewinding newer prose. | [`commands.ts`](commands.ts) · [`artifactContentRevision.ts`](artifactContentRevision.ts) | [`artifact-content-revision.test.ts`](artifact-content-revision.test.ts) · [`../../server/routes/artifact-content.test.ts`](../../server/routes/artifact-content.test.ts) | refines API-D1; requires CONTRACT-D9 |
| API-D14 | data-access | Proposal verdict commands carry one logical idempotency key, publish the acknowledged proposal collection, and invalidate derived stale state whenever its relation, routine, or artifact target changes. | [`commands.ts`](commands.ts) · [`events.ts`](events.ts) | [`../controller/proposal-verdict-mutations.test.ts`](../controller/proposal-verdict-mutations.test.ts) · [`../../server/routes/proposals.test.ts`](../../server/routes/proposals.test.ts) | refines API-D1; requires CONTRACT-D10 |
| API-D15 | data-access | Desktop provider credential entry and rotation cross one optional write-only native adapter; replacement sends the reviewed connection revision and one retained idempotency key, monotonically accepts its public acknowledgement, and reconciles conflict or uncertainty. The web build retains environment-reference requests, and neither path adds a raw key to HTTP. | [`desktopCredentials.ts`](desktopCredentials.ts) · [`commands.ts`](commands.ts) · [`../controller/providerConnection.ts`](../controller/providerConnection.ts) | [`desktop-credentials.test.ts`](desktop-credentials.test.ts) · [`../controller/provider-connection.test.ts`](../controller/provider-connection.test.ts) · [`../../server/routes/routes-providers.test.ts`](../../server/routes/routes-providers.test.ts) · [`../../desktop/credentialProtocol.test.ts`](../../desktop/credentialProtocol.test.ts) | refines API-A1; requires CONTRACT-D11; requires DESKTOP-S2 |
| API-D16 | data-access | Desktop backup creation and folder reveal cross one optional native adapter; web shows no device controls, and the renderer receives only filename, size, and creation time—not a path, file contents, or restore authority. | [`desktopData.ts`](desktopData.ts) · [`desktopCredentials.ts`](desktopCredentials.ts) · [`../components/DesktopDataCard.tsx`](../components/DesktopDataCard.tsx) | [`desktop-data.test.ts`](desktop-data.test.ts) · [`../../e2e/desktop-data-backup.spec.ts`](../../e2e/desktop-data-backup.spec.ts) | refines API-A1; requires DESKTOP-O2 |
| API-D17 | data-access | Agent configuration edits send the revision read by the controller and publish only the addressed acknowledgement; the configuration fence rejects older acknowledgements while independently moving contribution and fork counts merge monotonically, and tenant-safe Agent events heal private and directory projections. | [`commands.ts`](commands.ts) · [`agentRevision.ts`](agentRevision.ts) · [`events.ts`](events.ts) | [`agent-revision.test.ts`](agent-revision.test.ts) · [`connectivity-freshness.test.ts`](connectivity-freshness.test.ts) · [`../../server/store/event-tenancy.test.ts`](../../server/store/event-tenancy.test.ts) | refines API-D1; requires CONTRACT-D16 |
<!-- context-rules:end -->

## What lives here

The only code in the UI that knows the backend exists: `cache.ts` (the read
model), `events.ts` (the SSE router), `hooks.ts` (what components consume),
and the command senders. Wire types come from
[`contract/`](../../contract/CLAUDE.md) verbatim — never re-declared here.

Beside them, the suites that lock the door's contract: acknowledged relation
snapshot ordering, the account guard, freshness/refetch behavior.

## Rules

- **The frontend is a CACHE of the backend, not a second source of truth.**
  Every feature is server-owned; this layer holds a projection of it. No inline
  fixtures, no client-invented entities — if the UI can show it, the server can
  serve it, and it survives a reload because the server said so.
- **One door.** Components read hooks; controllers issue commands. A component
  that learns a URL or an SSE event name has broken the seam that makes the
  contract portable.
- **Reachability is the UI capability proof (INV-11).** Every backend operation
  used by the shipped UI must pass a declared `paths.*` entry through this
  funnel. The cross-layer parity lock follows imports into real consumers; an
  unused wrapper cannot pretend the UI has a capability.
- **Relation entities are server-owned.** A relation edit does not paint a local
  graph or invent an entity id before acknowledgement. Its full returned graph
  is accepted only when its server revision cannot rewind a newer projection.
- **Every declared `ServerEvent` has a producer and a consumer.** The
  contract-level scan (`tests/contract-boundaries.test.ts`) fails on a stale
  handler or an unhandled event — so adding an event means wiring both ends.
- **Absence has fixed meaning (INV-9).** An absent field inherits, means a
  complete-set constant, or means minimal-risk none — it is never resolved into
  a privileged value on the caller's behalf.

## Verification

Run API sibling suites plus both cross-layer boundary/parity locks after path,
event, hook, or command changes.
