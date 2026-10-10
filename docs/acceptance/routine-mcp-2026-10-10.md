# Bounded Routine MCP acceptance — 2026-10-10

Local browser and unsigned Apple Silicon Electron acceptance passed for the
working revision based on `7e850499`. This is an implementation checkpoint, not
a signed release or public-service acceptance claim. The complete local verifier
and post-test diff review remain mandatory before commit and push; their final
outcome belongs in the checkpoint handoff. GitHub CI is not used.

## Verified workflow

The owner chooses exact inspected tools, fixed top-level argument values, a
per-run attempt cap and expiry, then reviews the definition and audience before
approval. Contexts and Commissions confer no unattended authority. Revocation,
expiry, definition/configuration/sharing changes and connection/schema changes
close admission. A queued run retains its original permission; later approval
cannot widen it. Keyed decision Retry returns current truth without regranting.

Each external reservation is committed before transport and prohibits replaying
the model prompt. Private receipts retain exact arguments and known outcomes.
Uncertainty or a possibly effectful tool error stops further calls, pauses the
Routine and revokes permission. Restart interrupts pending work, retains a known
result when the model had not finished, and never repeats its external call.
JSON and SQLite recovery tests inspect the durable state immediately and again
after a second restart. Invalid identity/decision/run joins refuse hydration.

## Browser and visual evidence

All six tests in [the browser journey](../../e2e/routine-mcp-permissions.spec.ts)
passed on the reviewed UI revision, using real routes, runner and local protocol
peers. They cover owner review/revocation, exact committed-but-lost acknowledgement
and same-key recovery across navigation, shared/foreign walls, authoritative
unavailability versus transient failure, uncertainty and successful model output.
Approval projections and receipts never enter the shared Routine response.

The UI-review skill expanded the scope to every registered surface because
shared cache/accessibility helpers changed. `npm run ui:sweep` passed 135/135
cells, with zero violations and zero skips, across 320×700, 375×812, 768×1024,
844×390 and 1280×800. Screenshots are under `.data/ui-sweep/`.
The feature journey additionally captures top and lower content for empty,
choices, review, approved and uncertain states at all five sizes. Expanded schema
readers pass real keyboard scrolling and exclusion-free accessibility checks.
UI-186, UI-202 and UI-207 lock the named icon, keyboard reader and private cached
permission behavior. UI-208 separately removes the blank template's hardcoded
“paused” lifecycle from its route-owned description, preserving saved user text.
Its all-template lock failed before correction; five-viewport header assertions
and native Active-header checks cover the replacement “New workflow” caption.
This seed-copy-only correction does not change shared layout or account worlds;
the affected Routine states are recaptured at all five viewports.
The live development preview remains signed in as Ada with
the demo roster stacked; legacy non-owned seed Routines disclose unavailability.

## Packaged evidence

The complete rebuilt `npm run desktop:verify` passed, including the original
ordinary-executable and Contribution gates plus
`npm run desktop:smoke:routine-mcp`. The new driver uses a generated profile and
an excluded disposable loopback-enabled ASAR copy. It preserves and rechecks the
original package; no production bypass or fixture ships. Ordinary Electron
launch, OS-backed authentication/credential storage and SQLite remain real.

Rendered approval fixes one inspected tool and exact argument. The real Routine
runner sends one exact MCP call, consumes its result through the model seam and
persists the exact final output. Approval and private receipt survive a signed-in
full relaunch. Rendered revocation prevents another call. A later run is stopped
after the known MCP result but before model completion; independent relaunch
recovers it as failed/interrupted with permission revoked, Routine paused and no
replay. Its known result remains done, not falsely relabeled uncertain.

Local screenshots and generated evidence are under
`.data/desktop-routine-mcp-smoke/run-qd1G8u/`; they are not shipped or committed.
The owner-approved, private-receipt/output and interrupted-after-relaunch views
were inspected. See [DESKTOP-V16](../../desktop/CLAUDE.md) and
[the native journey](../../desktop/routineMcpSmoke.mjs).

## Regression sensitivity and limits

Failure-first checks exercised expiry and receipt hashing, strict owner and
approval-decision/run joins, immutable empty-ledger authority, stopping after an
effectful error, durable known-result recovery and package exclusion. UI checks
caught unnamed delivery icons, unfocusable bounded readers, misleading authority
copy and missing audience invalidation. A delayed-GET cache regression failed
before removing direct read publication. Final review then reproduced an account
transition between the transport's last check and acknowledgement publication.
Different-account and away/back regressions both failed before adding a generation
check immediately before the synchronous cache write. The earlier full verifier
was intentionally stopped before this edit and is not final acceptance; fresh
focused browser/native and complete local verification are required afterward.
The corrected browser and complete native gates then passed; a final native
screenshot review caught the template caption defect described above. The second
full verifier was stopped before that seed-only correction, so neither interrupted
full run counts as acceptance. After the seed fix, all six browser journeys
passed again, and a rebuilt package passed the dedicated native Routine gate.
The refreshed feature captures and three native captures were re-reviewed;
ordinary Routine output is verified by exact API assertions, not by the private
receipt screenshot. No markup or layout changed in these final fixes.
Restored implementations passed their
focused locks. Shared event fan-out was deduplicated without raising bundle
budgets or weakening invalidation coverage.

The first completed full verifier exposed one browser-test isolation defect:
the owner selection assumed a unique tool name, but preceding tests left other
connections offering that same name. Selection now addresses the exact unique
connection card, and the focused scenario deliberately creates a second same-name
tool so it exercises this condition without depending on test order. The other
four lanes passed; this failed run is not the final landing gate.

This evidence uses local model/MCP protocol fixtures. It does not prove a paid
provider, public TLS MCP service, signed/notarized download, Intel execution or
manual native-dialog interaction. Those remain separate release gates; no new
external credentials or public-service authority were requested or exercised.
