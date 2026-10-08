# Desktop preview plan

Reviewed 2026-10-08. The standing goal remains production readiness for Agent
Commons, with desktop first and a hosted service later. Progress is judged by
complete user workflows and release evidence, not the number of hardened
mutation paths. Routine refactors and recovery work should support these
milestones or address a demonstrated defect.

## Current checkpoint: truthful automation availability

The owner approved both pending automation defaults on 2026-10-08:

- Real Dispatch explicitly selects an Agent and endpoint model, saves its result
  in a private conversation that can be continued, and requires fresh confirmation
  for each external tool call.
- Unattended Routine MCP is opt-in per Routine, limited to selected tools and
  reviewed argument constraints, with per-run call limits, expiration and immediate
  revocation. Changed tool definitions require renewed approval. Results follow
  the disclosed destination's sharing; uncertain calls are never automatically
  repeated. Call limits are not monetary caps and third parties may charge.

These are approved implementation directions, not live grants or authorization
to use a paid provider/public MCP service for acceptance. Existing Commissions
do not inherit either permission policy.

Before those workflows, the audit found a release-integrity defect: legacy
Dispatch completed on a timer, Project effects and Agent proxies returned
synthetic success, and eligible standing Commissions could mark posted work done
and award credit without any execution adapter. MOCK-9 gates those fixtures at
the store and route boundaries, before cached Dispatch replay. Release posting
and Commission configuration remain available but leave new work open, including
A2A submissions. Real Routines and explicitly confirmed Contribution MCP are
unchanged. One backend capability drives honest development/release disclosure
and closed-by-default Dispatch controls, including the rail action.

Store and route locks were watched fail against the old implementation and now
pass. The final local verifier, full UI sweep and rebuilt packaged acceptance
remain the landing gates. Next: implement the approved real Dispatch workflow,
then bounded Routine MCP grants; no further policy approval is needed for those
defaults. The rendered regression also caught a rail action that looked enabled
while its page handler was blocked; both now use the same capability policy.
Unknown availability avoids promising that work will stay open on a development
backend. The page-action structural lock now enumerates complete elements rather
than imposing an arbitrary source-character limit; its negative check failed as
expected. Signing/notarization, hosted delivery, Intel and public-service acceptance
remain separate release gates.

The A2A instance card now states the same runtime boundary for protocol clients;
its profile-aware route regression failed before the repair and passes afterward.
Focused rendered checks pass, including five viewport sizes, owner/reader/foreign
scope and short-landscape keyboard/scroll reachability. The complete broad sweep
passes all 135 cells with zero violations or skips, and its captures were reviewed.
The rebuilt unsigned arm64 desktop gate passes, including original-package
automation refusal and the isolated Contribution MCP fixture. The complete local
verifier remains the final landing gate before push.
The first package build caught an initial-bundle overrun caused by eagerly loading
all disclosure copy through the rail. The tiny capability predicate is now shared
separately from lazy page copy; the existing size budget is unchanged. The initial
broad sweep was stopped before further edits; the successful sweep above ran on
the repaired revision.

## Completed checkpoint: native Contribution MCP acceptance

Shipped as `73c995b3`: the complete local verifier passed all five lanes and
597 browser tests. The detailed pre-landing record below is historical evidence.

The exact-bound Contribution workflow now has a feature-specific macOS fixture
gate. The original unsigned package must refuse a loopback MCP connection
without contacting it. Only a disposable app copy changes the startup network
scope; the original ASAR is hash-checked before and after. Actual packaged UI,
HTTP, schema worker, OS credential vault, account sharing and SQLite remain real.
Rendered proposal/approval performs no call; separate confirmation sends exact
arguments. Full process interruption and signed-in relaunch retain uncertainty
without replay, preserve cardinality, and retain exact managed-backup history.

The native gate passed, then deliberately disabling pending-to-uncertain recovery
made its rendered uncertain-state check fail. Restoring recovery is mandatory
before final acceptance. Removing the fixture's package exclusion likewise made
its source lock fail. All helpers remain excluded from the shipped app; the
signed-release smoke never substitutes this modified copy. This closes only the
local feature-specific native fixture gap, not public-service/TLS, paid-provider,
signed/notarized or Intel acceptance. Final `desktop:verify` and the complete
local verifier are the landing gates; no GitHub CI is used.

The rebuilt complete desktop gate passed. Final review strengthened exact peer
result comparisons in public history and SQLite; that journey passed again on
the unchanged original ASAR. All five final captures were reviewed. The
[acceptance record](acceptance/native-contribution-mcp-2026-10-08.md) binds the
scope, package digests and negative checks. The complete frozen local verifier
passed before push.

## Completed checkpoint: bounded Routine execution

Shipped as `c268c3ce`: the final strengthened local gate passed all five lanes
and 597 browser tests. The pre-landing history below records the checks performed.

The core-workflow audit confirmed two unfinished automation directions. Real
Dispatch still needs an approved Agent/model and result-destination policy;
external MCP calls in unattended Routines need separate scoped standing authority
or a pause-for-confirmation workflow. Both decisions have been requested and are
now approved as recorded above. The earlier pending decision did not authorize
either policy change before that explicit owner approval.

The existing PD60 requirement for bounded automation can proceed independently.
The Routine worker now queues durable rows under process/tenant/tenant-Agent
limits (defaults 4/2/1), without spending attempts until admission. Ready order
is preserved within competing scopes while eligible other scopes can proceed.
Repeated recovery/wakeup calls cannot duplicate active runs. Admission rechecks
authority and budget; retries release capacity during backoff. Stop/start keeps
abort-ignoring work counted until settlement, and late cancelled results cannot
publish. Fatal state transitions stop admissions before supervisor reporting;
failed storage commits are never treated as transient model failures.

Focused locks cover limits, fairness, deduplication, current authority, retry,
shutdown, fault handling and zero-attempt restart recovery. The global limit,
Agent limit, cancellation retention and fatal-commit locks were each watched
fail under targeted implementation mutations, then restored. The complete local
verifier remains the landing gate. No UI, external-tool authority, persistence
shape or provider credentials changed; this does not complete real Dispatch,
standing MCP permissions, spend reservations or the wider production goal.

The first complete local gate passed checks and three browser shards; one MCP
browser walk failed because its connection had moved behind the picker's real
“More available” disclosure as the worker's fixture registry grew. The harness
now drives that portaled tail, and the long-label case deliberately creates a
crowded registry and proves the target is not inline. Disabling overflow lookup
failed at that exact hidden row; restoring it passed all seven focused MCP
browser tests. No product behavior, assertion, retry count or timing budget is
relaxed. The complete frozen local gate remains required before landing.

That corrected full run passed all five lanes and 597 browser tests. Review then
strengthened the shutdown lock to wait for the actual generator and worker
continuations before asserting unchanged state. Removing late-result fencing
made it fail with a falsely completed run; the implementation was restored. The
final strengthened test revision repeats the complete local gate before push.

## Completed checkpoint: real Contribution execution

Shipped as `c9dffd0b`: the corrected final local verifier passed all five lanes
and 597 browser tests. The broad review covered 135/135 cells without violations
or skips, and the rebuilt unsigned arm64 native regression passed. The detailed
pre-landing history below is retained as evidence, not outstanding local work.

The exact-bound Contribution execution foundation was pushed at `576bbce7`
after its final local run passed 4,800 Node tests and 593 browser tests. The
current checkpoint integrates that foundation with the Contribution store,
HTTP route, strict durable attempts, restart recovery and explicit first-party
Run flow. Focused JSON/SQLite, route, restore, durable-commit and controller
locks pass. The final frozen revision must pass the complete local verifier,
broad UI sweep and packaged/native regression acceptance before landing.
No public or paid MCP service has been used.

The owner has approved Project-reader visibility for Contribution tool arguments
and results. Credentials stay private. Proposal review must disclose that the
arguments will be shared, and each separate Run confirmation must disclose the
result's sharing scope. Execution uses only the initiating person's existing
connection, never another Project member's credentials.

The real path selects one existing MCP tool on the initiating person's own
connection, binds its reviewed schema and exact arguments to an approved
envelope line, and requires a separate human Run confirmation for each call.
Arguments and bounded results are Project-reader-visible; credentials and
private connection authority are not. The server commits a pending receipt and
slot reservation before I/O. Only a known pre-submit failure releases a slot;
pending blocks amendment and landing, restart converts it to durable
uncertainty, and exact retries only read the existing receipt. Receipts are
append-only and capped at 100. Invalid or oversized results become uncertain,
without truncation or automatic replay.

Adversarial persistence review added approval-event correlation, a permanent
effects-fired floor and strict pending-state admission. Browser review found
pane-width clipping and insufficient contrast on tinted consent panels; UI-9
and UI-205 now name the shared layout and readable-ink funnels. Transport is
loaded before admitting effect controls, so a failed code import is not mistaken
for an uncertain submitted call. A lost acknowledgement offers receipt-only
checks; dismissing local recovery never suppresses the next call's duplicate-risk
warning. Optional extraction preserves the existing bundle budgets.

All four focused browser journeys passed, with 41 reviewed screenshots spanning
proposal, separate confirmation, owner/reader/foreign views, durable uncertainty,
and module loading/recovery across the five viewport tiers. The rebuilt unsigned
arm64 Electron regression suite also passed. Final review then found that
switching an MCP draft back to a simulated act retained the incompatible
`explicit-call` harness; the shared transition now clears MCP authority and
restores a valid simulated harness, with pure and rendered regression locks.
Final acceptance repeats on that correction, including unresolved-acknowledgement
controls at all five sizes. The incomplete pre-correction broad sweep was stopped
before editing and does not count as acceptance evidence.

On the corrected implementation, all four focused journeys pass with 46 reviewed
captures. The complete broad sweep passes 135/135 cells with zero violations or
skips; every viewport column has been visually reviewed. The rebuilt complete
unsigned arm64 `desktop:verify` suite also passes, including existing OS-storage,
SQLite, sharing, restore and signed-in relaunch regressions. The first full local
verifier passes all four browser shards, but its checks lane finds two context
documentation defects: a one-line budget excess and an invalid rule relation.
These are corrected without changing runtime code, and the complete local gate
repeats on the final frozen tree before landing. No GitHub CI is used.

The legacy simulated envelope-effect path remains a deterministic development
fixture and is refused in release profiles. Harness labels (dry-run, escrow,
canary, cooling and hold-until-landing) do not authorize real effects. Local
loopback fixtures validate the implemented exact-bound workflow, not a public
service. The later checkpoint above adds isolated native fixture acceptance. Signed/notarized, Intel and real-service
acceptance remain independent release gates.

## Completed checkpoint: Artifact saved context

The owner approved both pending defaults on 2026-10-08. Artifact context is an
explicit saved copy governed by the destination conversation's sharing; only
explicit Refresh reads the current source again, and source revocation does not
erase an existing copy. The current Contribution execution checkpoint is
tracked separately above; these Artifact-context permissions do not authorize
public MCP service use.

Conversation download landed at `86ef5e73`: all five local verifier lanes passed
(583 browser tests), the broad UI sweep covered 135/135 cells without violations
or skips, and the rebuilt ordinary unsigned arm64 Electron lifecycle verified
exact owner/reader downloads before and after relaunch.

The next complete workflow is Artifact-as-context. It reuses the saved Discussion
copy's draft/first-send, destination-owner mutation and acknowledgement recovery
paths. A copy includes the complete canonical document, sheet, workbook, slides
or figure body; model input derives whole text/data from that one immutable
body under the existing attachment budget. Unsupported, unreadable, bodyless or
oversized sources are refused, never replaced with excerpts or name aliases.
Saved previews preserve each body's nature without source reads or editing.

Implementation and fail-first locks are present. The first permitted full Node
run passed 4,760 tests. Focused route/contract/persistence and controller locks
also passed. A new late-acknowledgement test caught draft adoption after account
replacement: the shared draft funnel now checks account generation after each
wait while preserving valid same-account coalesced sends. The startup budget
caught new eager parser cost; optional connector/workspace panels and connector
detail now share lazy admission with visible loading/recovery rather than a
larger budget. The corrected build and typecheck passed.

Adversarial review also caught an organization-owner source-read mismatch:
copy capture used the destination organization rather than the authenticated
person's current read access. Both Artifact and Discussion now carry that
requester through the existing owner-gated capture/Refresh funnel. A realistic
owner-seat route test failed before the repair and now proves capture, explicit
Refresh and refusal after the source enters Trash without erasing saved copies.

The three Artifact browser journeys passed, including 35 reviewed viewport
captures. The complete unsigned arm64 Electron suite passed; its Artifact
receipt verifies exact model input, SQLite, sharing, permanent source deletion,
signed-in relaunch and detach. The broad sweep exposed a harness timing defect:
its fixed 300 ms delay judged a still-exiting panel as stuck on tablet and
captured a pointer-disabled phone panel mid-exit. A fail-first sweep lock now
requires bounded DOM disappearance, not elapsed time, before judging or taking
the next screenshot. Browser acceptance repeats with that stronger condition.

That stronger check then exposed a real cold-load race: a module resolving
during Close could replace the exiting loading shell and leave the new motion
root mounted indefinitely. UI-204 fixes admission once at the shared PanelShell
for all context families; a late shell renders nothing and completes its own
presence participation. The held-import browser case failed before the guard
and passed on phone/tablet afterward. All six cold Workspace, Repository and
Connector cases pass. Their gate waits for exact request completion before
cleanup and for the unrelated seeded panel to finish exiting after preference
hydration; no route errors are swallowed or dismissal assertions weakened.

Owner/shared/foreign, source-revoked, draft, held-refresh and all five viewport
tiers passed browser acceptance. The final broad sweep passed 135/135 cells
with zero violations/skips; every captured viewport column was reviewed.
The rebuilt complete `npm run desktop:verify` passed after the shared-shell
repair. Its Artifact receipt is `.data/desktop-artifact-context-smoke/run-vvvwvl/receipt.json`
(ASAR SHA-256 `79f337825cde0f5a47212fe270b5ead8cdb40a29f5b1942cee9e3d2e80c3c584`).
Full local verification and post-test diff review remain the final landing
gates. The entire tree freezes for acceptance. Contribution execution follows this checkpoint; signing,
notarization, Intel and real-service evidence remain separate release gates.

The first complete verifier passed static checks/build but found three browser
failures. Exact Repository-header selection and awaited workbook-tab text fix
two asynchronous assertion races. The third reproduced under retained trace:
a replaced Workspace loading shell finished its old exit after unregistering,
recreated a stale presence claim, and blocked a later folder-detach dismissal.
The shared `panelPresence` adapter now forwards completion only for live
registrations; rejected shells also pair manual registration with cleanup.
Both pure negative controls fail without that filter. The unchanged five-size
draft/detach journey and all six cold-panel cases pass with it. UI-204 covers
this additional lifecycle edge. Final broad UI, rebuilt native and full local
verification repeat on this corrected revision before landing.

On the corrected revision, the broad UI sweep again passed all 135/135 cells
with zero violations/skips, and the rebuilt complete `npm run desktop:verify`
passed. The final Artifact receipt is
`.data/desktop-artifact-context-smoke/run-0ABtnI/receipt.json` (ASAR SHA-256
`a147867df6d6f0fb83a256daee9562a7fb510ad2b0b506f7f7b7d66293dd6eb0`).
The second full local verifier passed checks/build and 591/592 browser tests.
Its sole failure was the narrow conversation accessibility audit: retained trace
showed the deferred Repository body mounting after the audit's finite-animation
snapshot, so axe measured blended entrance paint. E2E-V3 now explicitly sets
the durable Repository preference, awaits its actual code body, then proves the
correct tier, full ancestor opacity and stable geometry before scanning. The
new source lock failed before that repair; all 14 focused WCAG journeys passed
afterward with unchanged rules, exclusions and budgets. Product runtime is
unchanged from the accepted visual/native revision. The complete local verifier
repeats on the final frozen tree with first-failure traces and no automatic
retries; no GitHub CI is used.

The third full verifier passed checks/build and 591/592 browser tests, including
the repaired accessibility audit. Its sole failure was a test-only MCP proxy
connection reset on reload, precisely six idle seconds after the previous
successful request and before teardown. The installed Node runtime's 5-second
keep-alive timeout plus 1-second buffer explains the pooled-socket expiry race.
The in-process fixture now closes each response connection. A new behavioral
lock failed on the former `keep-alive` response and now proves two successful
requests use exactly two sockets; the original durable-uncertainty reload
journey also passes. No request retry, deadline increase or production network
change was introduced. E2E-O1 owns the rule; the final full gate now includes
593 browser tests.

The fourth full verifier passed checks/build and 592/593 browser tests. The
remaining failure captured an old-document session poll during image-download
reload, before the new document's JavaScript loaded; navigation invalidated its
response-body handle. E2E-V73 now waits for the newly writable composer and
reads fresh request-context metadata, retaining the real preview and exact-byte
download assertions. The source lock failed before repair, and all eight
image-original browser journeys now pass. Product runtime remains unchanged;
the complete gate repeats on the frozen final revision.

## Completed checkpoint: conversation download

The previous checkpoint landed at `c6ba70b2`: rebuilt unsigned arm64 package,
complete native smoke and all five local verifier lanes passed (578 browser
tests). The real signed-in relaunch retained 44 exact saved messages.

The next complete workflow is a readable conversation download (ADAPT-42), not a
new sharing policy. Owner and currently granted reader use the existing read
wall for an explicit fresh Markdown snapshot. Saved user/assistant text,
retained compacted originals and the current summary are separated and labeled;
private context, tool payloads and attachments never enter the file. Downloads
refuse while a reply is active or if the complete UTF-8 file exceeds 8 MiB.
Close, navigation and account changes retire pending browser work.

Read-only review identified speaker-like Markdown/raw HTML inside messages as a
content-integrity problem; a fail-first lock now requires collision-free literal
blocks without changing original text. The cold build budget also caught 199
excess bytes; Find and Download now share their lazy loading/recovery boundary
instead of increasing the budget. Fresh authorization, descriptor validation,
retry and export side effects have dedicated locks.

The first focused browser run passed eight of nine journeys and caught a
short-landscape shared-reader accessibility defect: the prose-only scrolling
disclosure had no keyboard entry point. UI-202 adds one shared named read-region
funnel and fail-first source/browser locks; the five-size matrix repeats after
repair, including Escape return focus and always-visible download controls.

The broad sweep completed 135/135 cells with zero violations or skips. All 15
affected titlebar captures were reviewed; Download fits at every tier and stays
absent from drafts. The corrected dialog matrix passed; retry assertions now
name the dialog's own error instead of colliding with an unrelated interrupted
conversation notice, and revoked screenshots reissue the rejected read at every
size. Final focused, packaged and complete-verifier runs follow on the frozen
tree. A final lifecycle review consolidated Find/Download into one pane-local
selection so late module loading cannot mount competing dialogs; a fail-first
source lock and browser import gate cover that overlap without changing layout.
The first native export attempt exposed an acceptance-harness mismatch: ordinary
CDP launch has no injected Electron application handle. Download acceptance must
retain that ordinary process/OS-storage lifecycle and configure only its browser
download destination, not substitute a different launcher.

The corrected ordinary Electron suite passed, including exact owner/reader
downloaded bytes before and after signed-in relaunch; all eight native download
captures passed review. The first complete local verifier passed all four
browser shards but its checks lane caught an off-scale 17px dialog title and a
deliberate traversal filename misclassified as a source reference. The title
now uses the existing 15px step (UI-27); the path lock explicitly identifies
that one non-read fixture without weakening traversal rejection. Acceptance
repeats on this final correction before landing.

Acceptance covers owner/shared/revoked/foreign states, five viewport sizes,
keyboard and WCAG checks, the full 135-cell UI sweep, and actual Electron saved
file bytes before and after relaunch. Complete local verification and post-test
diff review remain required before committing and pushing this checkpoint.
The entire tree stays frozen during acceptance. Release signing/notarization,
native Intel, public hosting and real-service gates remain open; pending
Contribution execution and Artifact context decisions are unchanged.

## Completed checkpoint: packaged conversation search and relaunch

The browser checkpoint landed at `37b14c3f`: all five local verifier lanes passed,
including 578 browser tests. The broad sweep covered 135/135 cells with zero
violations/skips, and the final five-size search matrix repeated after its help
copy correction. That evidence does not yet prove the packaged Electron path.

The new acceptance extends the existing ordinary Discussion lifecycle, profile,
local model fixture and signed-in relaunch. It creates 44 exact saved messages,
placing the first of two matches outside the initial 40-message read. Owner and
shared-reader search must open that exact turn through real earlier-history
loading; an ungranted account must neither discover nor read the conversation.
Search cannot mutate its messages or invoke the model. Reload and Back retain
the canonical conversation URL without treating transient focus as a bookmark.
Read-only SQLite checks compare exact IDs and bodies before quit, after process
exit and after relaunch; the helper remains outside the shipped application.

Required evidence is a rebuilt host-architecture package, a deliberately broken
search-target check rejected by the native workflow, reviewed native captures,
the complete packaged smoke and final full local verifier. This checkpoint
changes acceptance code, not rendered product surfaces; the prior responsive
matrix remains applicable unless native acceptance discovers a product defect.
Unsigned Apple Silicon evidence does not close signed/notarized distribution,
native Intel, public hosting or real-service acceptance. The pending Artifact
context and Contribution execution decisions remain separate; no GitHub CI is used.

The rebuilt unsigned arm64 package passed its packaging checks. A test-only
response mutation replaced a real message match with a nonexistent target; the
native exact-turn assertion rejected it. Review also added an explicit empty
foreign-account search API assertion, independently of UI filtering, with a
failing-then-passing lock. The complete unmodified packaged run and final local
verifier remain the landing gates; neither result is inferred from these checks.
The first normal native run reached the exact highlighted turn but exposed a
test-only paragraph assertion: DOM text nodes concatenate Markdown paragraphs.
The assertion now reads visible text, retaining the exact content expectation;
the independent HTTP and SQLite comparisons still check every original byte.
The next complete native run passed, but visual review caught landing captures
midway through the real message fade-in. The helper now waits for full opacity
before asserting the highlight and capturing evidence; its lock failed before
that correction. Final native captures and the complete verifier are repeated
on the frozen corrected tree, without changing the renderer or its animations.

The corrected complete `npm run desktop:smoke` passed on the unchanged unsigned
arm64 package (ASAR SHA-256
`000fcd37a82c3a32593790ee9d359ef8e59d48fea85e1588abbe18b2eb3f494e`).
Its real signed-in relaunch retained all 44 exact messages; all ten search
captures were reviewed with readable text, visible exact-turn highlights and
distinct owner/shared/foreign states. The built ASAR contains no search acceptance
helper. Existing credential, import/OCR, export, MCP, backup and restore phases
also passed. Final full local verification and post-test diff review remain
required before committing and pushing this checkpoint to `main`.

## Completed checkpoint: search saved conversation text

Global search now includes current user/assistant text in human-initiated
conversations, including conversations readable through an explicit grant.
One result per conversation previews its first matching message and opens that
exact turn in the landing pane, loading earlier history through the existing
Find mechanism. Metadata-only matches retain the ordinary conversation door.
Archived originals, tool output, attachments and scheduled-run conversations
remain outside this search. Existing category paging counts conversations, not
messages; Find in conversation remains the way to inspect every matching turn.

All global queries share a 256-character bound. Saves refresh open results;
deletion and sharing changes evict obsolete snippets. The projection shares its
literal matcher and read permission with conversation Find, introduces no index
or new backend operation, and preserves transient highlight semantics (the
conversation URL remains canonical; highlights are not persisted in history).
Fail-first route, navigation and freshness locks precede implementation. Browser
acceptance covers older-message landing, duplicate panes, shared/foreign access,
revocation, live arrivals and stale targets. Full local verification and the
135-cell UI sweep remain required before landing; no GitHub CI is used.

The first affected browser run passed 20/21 journeys and caught low-contrast
muted text on highlighted turns. The shared arrival-highlight class now uses its
paired foreground, locked across palettes/modes and by the rendered WCAG walk.
Read-only review also found an initial-read false missing-message announcement;
arrival loading/failure must settle before absence is asserted, with an explicit
Retry retaining the same target. These are checkpoint acceptance findings, not
new product directions.

The broad responsive sweep completed 135/135 cells with zero violations or
skips. Subsequent review narrowed the search help to message-text matches so it
does not promise exact-turn focus for title-only results; its source lock failed
before the correction. The final local verifier repeats the affected five-viewport
journey after that wording change, with the entire tree frozen during each run.

The previous draft-local Undo/Redo checkpoint landed at `a48c9eaa` with all five
local verification lanes green (574 browser tests), 135/135 UI cells and complete
unsigned arm64 packaged smoke. Artifact-as-context and real Contribution
execution still await their separate sharing/execution-policy decisions.
Signed/notarized distribution, Intel and real-provider acceptance remain open.

## Completed checkpoint: draft-local Artifact Undo/Redo

Complete Document, Sheet, workbook and Slides editors now share bounded,
memory-only Undo/Redo: up to 50 recent states and 2 MiB serialized history per
draft. Focused typing coalesces; paste and structural actions are separate steps.
Exact block/worksheet identities survive traversal. History follows the shared
draft through navigation and duplicate panes, but never rewrites saved versions.
Save acknowledgement, Cancel and account disposal clear it; held uncertain or
conflicting saves disable traversal until the existing recovery releases them.
The opening revision and explicit whole-body Retry consent remain unchanged.

Visible controls and scoped keyboard commands replace competing paste/removal
undo controls only in saved editors. Creation dialogs retain their existing
one-step reversals. Read surfaces and remote MCP gain no new operation or access.
Unit/controller/source locks were watched fail before implementation. The new
browser journeys cover four formats at all five viewports, structural identity,
typing/paste grouping, duplicate panes, navigation and held recovery.
An intentional disconnected-Undo mutation failed the exact browser value check
before the original implementation was restored. Packaged
Document and Sheet import acceptance also exercise exact Undo/Redo restoration.
Final full local verifier, UI sweep and unsigned native outcomes are recorded in
the checkpoint handoff; they remain mandatory before landing.

Artifact-as-conversation-context and real Contribution execution remain separate
pending sharing/execution-policy decisions. Neither is implicitly authorized by
this draft-recovery feature. Signed/notarized distribution, Intel and real-provider
acceptance remain open production gates; GitHub CI is not used.

## Completed checkpoint: packaged Document editing and migration

The full editor shipped at `3ce125a4` after the local verifier passed all five
lanes, including 570 browser tests, and the 135/135-cell UI sweep passed with no
violations or skips. The new native acceptance extends the existing ordinary
Artifact history launch/relaunch lifecycle rather than adding a privileged test
bridge or another user-data profile.

The focused unsigned arm64 packaged workflow passed: the built renderer edits
the title and all five block kinds, inserts/reorders/deletes under one exact
revision-fenced Save, and retains literal list/code entries. Discussion doors
follow moved originals and explicitly label deleted originals before and after
signed-in relaunch. Exact current bodies, IDs, versions and discussion rows are
read from the real SQLite database.

A separate generated legacy fixture is staged only after the app exits and its
old service is unreachable. A compare-before-write transaction removes IDs only
from that fixture's current/history blocks, preserves all other rows and receipts,
and restores the old numeric discussion locus. Ordinary startup performs v5→v6
migration; exact restore lineage survives, the numeric discussion stays explicitly
unavailable, and a subsequent rendered edit appends a new revision without
rewriting its retained versions. Test-only helpers are excluded from the package.

Review found ID-less expectations in older direct-create, local import, image OCR
and scanned-PDF OCR native helpers. Their exact-content checks now include every
canonical block identity; the search helper also has a behavioral two-block lock.
`npm run desktop:package` and the complete `npm run desktop:smoke` passed on the
unsigned arm64 artifact, including the existing credential, import/OCR, export,
MCP, backup and restore paths. The actual ASAR excludes the new test helpers.
A disposable response mutation replaced the moved block's ID after Save; the
native workflow failed its exact-body assertion before the unmodified full run
passed. Editor, moved/deleted discussions and migrated-edit captures were reviewed.
The first full local verifier passed static/unit/build checks and three browser
shards, but exposed an existing discussion-copy test race: its request event
preceded the async route observer's saved-state read. That walk now waits for the
same POST's successful response before checking the exact pre-send empty copy;
no assertion, deadline or retry policy was relaxed. The focused regression and
all six discussion-context browser tests passed. A fresh trace-enabled full local
verifier passed all five lanes with 570 browser tests in 552.5 seconds; the
checkpoint landed as `dd18374b` and was pushed to `main`.
This milestone is unsigned Apple Silicon evidence, not signed/notarized,
Intel, paid-provider, or public-release acceptance. Those production gates remain
open; no GitHub CI is used.

## Completed checkpoint: full Document editing and stable discussions

The approved editor now covers title, headings, paragraphs, bullet items, code
lines and email headers, with insert, delete and keyboard-accessible reorder.
Whole-body saves reuse the account-scoped draft and explicit conflict recovery
workflow. Inline prose drafts also pin the opening revision and original block
ID, so a later reorder cannot redirect a held edit to its neighbor.

Authoritative creation and current reads identify every Document block. The
append-only v5→v6 migration assigns legacy history revision-local identities,
preserves already identified bodies and exact restore lineage, and refuses
current/history mismatches. Legacy numeric discussion anchors remain explicitly
unavailable. New anchors use stable IDs; deleted originals are labeled “original
block deleted.” Ordinary editing cannot resurrect a retired identity; explicit
saved-version restore can. Revision-fenced search positions remain unchanged.

Acceptance includes fail-first contract/controller/migration/route locks, the
five-viewport editor and owner/shared/foreign discussion journeys, the complete
135-cell UI sweep, and the full local verifier on the frozen final tree. These
are required gates, not implied by implementation. Packaged acceptance of this
new editor and migration remains a separate follow-up; previous native evidence
predates this rollout. Signing, notarization, Intel and real-service gates remain
open and no GitHub CI is used.

Review caught two additional boundary gaps before final acceptance. A transient
discussion focus could reveal a folded section only to hide it again immediately;
the shared section now latches navigation reveal locally, preserving global fold
preferences and explicit user folding. A browser test reproduced the failure.
Current-version snapshots with retained ID-less Document history must also refuse
admission instead of normalizing only the current body and making future edits
unappendable. Older version-5 snapshots still migrate current and history together.

All six focused Document browser journeys pass, including the reproduced
folded-section regression. Twenty editor/access/recovery viewport screenshots
and the full 135/135-cell surface sweep were reviewed; the sweep reports zero
violations and skips. The signed-in preview is left on Ada, light desktop, with
the six-account roster stacked. Existing Sheet/workbook recovery assertions now
follow the shared Artifact wording, and the removed-block assertion addresses the
held original rather than its obsolete ordinal. The first full verifier found one
remaining ID-less scheduled-output expectation; that assertion now verifies the
exact revision-local block identity alongside content. The complete local verifier
is the remaining mandatory landing gate for this tree.

## Completed checkpoint: Document block-identity foundation

The owner approved full Document editing with stable block IDs, insert, delete
and reorder. Discussions must follow the original block; deletion must leave an
explicit “original block deleted” state, never attach the thread to a neighbor.
This approval replaces the earlier pending Document-identity decision. External
Contribution execution and the outstanding release gates remain separate.

Implementation is staged without exposing structural edits prematurely. First,
the shared body contract, prose patch helper and history admission/append path
preserve exact IDs across all five existing block variants. A body is wholly
legacy or wholly identified; duplicate, malformed and partial identities refuse
admission. Restore must match the retained source including its IDs, independent
of object field order. This checkpoint neither assigns IDs to existing data nor
changes discussion/proposal addresses, the storage version, or editor controls.

Next, connect authoritative ID assignment, conservative migration and typed
anchor resolution before the full editor. Old history can contain whole-body
replacements, so equal indices or equal prose cannot establish lineage. Retain
provable identities; preserve ambiguous legacy anchors as explicitly unavailable
without guessing. Saved-source restore may reattach only the exact retained ID.
The editor must cover headings, prose, lists, code and email headers, retain
account-scoped drafts, require the reviewed body revision, and preserve explicit
conflict recovery. Existing revision-fenced search locations remain safe without
being turned into permanent block addresses.

Foundation acceptance includes tests observed failing before implementation,
exact JSON/SQLite restart and restore checks, focused history/content suites and
the complete frozen-tree local verifier. The UI-review skill's matrix is deferred
until renderer changes land; this checkpoint changes no rendered surface or
preview account. It does not claim the approved full editor is already shipped.

The focused 82-test content/history/route/persistence/context run passed. Negative
checks rejected the old ID-dropping parser, removed all-or-none/ID validation and
weakened exact-source restore. Review also exposed current Documents without
history bypassing ID checks; admission now validates identity-bearing bodies
before any backend save, with failing-then-passing tests for both backends.
Wholly legacy current-body admission remains unchanged. Sparse list/code arrays
are refused instead of turning missing lines into JSON nulls. The complete local
verifier remains the pre-commit/pre-push gate for this final tree.

The consumer audit also found Word export rejecting otherwise valid ID-bearing
blocks. Its admission now shares the portable block parser while retaining its
own title, XML and text limits. A failing-then-passing test proves all five block
variants produce byte-identical Word exports with or without IDs; no identity
metadata enters the package. The first verifier was stopped before this repair;
only the subsequent full run on the final frozen tree counts as acceptance.

## Completed checkpoint: packaged current and saved search workflow

Committed locally as `79ca86d3`: the complete unsigned arm64 packaged smoke and
all five local verifier lanes passed, including 564 browser tests. All eighteen
history/search captures were reviewed. The working tree was frozen throughout
final acceptance. The normal HTTPS push succeeded after transient GitHub server
errors; `79ca86d3` is now on `main`, with no force push or CI use.

The browser checkpoint is complete at `c5637ea9`: all five local verifier lanes
passed, including 564 browser tests; the responsive sweep covered 135/135 cells
with zero violations or skips. That does not establish the new reading locations
in the built Electron renderer or after a real process restart.

The existing ordinary Artifact-history acceptance now also creates exact
Document, Sheet, workbook and Slides bodies through the packaged API. Rendered
current search must reveal the actual field, select a later worksheet, restore
keyboard focus after visiting an equal-shaped tab, and preserve its location
through reload and Back. Current navigation must neither mutate Artifacts nor
read private history. Exact SQLite bodies and signed-in relaunch are checked
before repeating the four-format journey. Restoring the existing history fixture
also makes its old current locator stale; both launches must explain that state
without highlighting a substitute. The existing saved-search, access-wall,
comparison, cancelled/confirmed restore and receipt-replay checks remain.

Acceptance requires a newly built host-architecture package, a disposable ASAR
negative mutation that the rendered current-search assertion rejects, screenshot
review, the complete packaged smoke and a final frozen-tree local verifier.
The added helper is excluded from shipped code and reuses the existing real
profile/authentication lifecycle. No provider call or user document is involved.
Unsigned arm64 acceptance cannot close signing/notarization, native Intel,
real-service or release-hosting gates. Document identity was approved after this
checkpoint; external Contribution execution remains a separate product decision.

The focused ordinary packaged journey passed on unsigned arm64. A copied ASAR
with current-search locators removed then failed at the exact rendered Document
match URL, while the original package hash stayed unchanged. The first negative
copy failed before that assertion because its framework symlinks were rewritten;
preserving those links repaired only the disposable copy harness. All five new
source/packaging locks were watched fail against removed guarantees, then passed
after restoration. The focused receipt binds ASAR SHA-256
`47255cb0f1bb513d94c438640c99538f68753f72317b97832067b3474b1e9ddd`.
The complete packaged smoke and local verifier subsequently passed on the final
frozen tree, and the verified commit was pushed successfully.

## Completed checkpoint: reveal exact Artifact search matches

Current-body search closed the missing-text gap, but opening a result still hid
matches in later workbook tabs and left long bodies at their beginning. Search
now carries a revision-pinned authored-field locator through pane navigation,
Back and canonical current/history URLs. The reading surface selects the exact
tab, highlights the field and brings it into keyboard focus without editing.
Show match returns to it after browsing elsewhere. A changed current revision
or absent field is explained without applying an old position to new content.
Queries and body text never enter the address; ordinary metadata-only hits keep
their existing resource door. This does not introduce stable Document block
identity, new read authority or an external service.

UI-197 records the demonstrated hidden-match defect. Negative checks rejected
both removed revision fencing and first-tab-only initialization. Acceptance
requires current and immutable saved bodies, reload/Back, stale/missing targets,
all authored formats, owner/shared/foreign access, keyboard/viewport checks,
the complete UI sweep and full local verifier on the final frozen tree. The
packaged history acceptance helper follows the new search-derived URL; updating
that helper alone is not fresh native acceptance. Larger Document identity and
external Contribution execution decisions remain outside this checkpoint.

Adversarial review reproduced a Show match focus failure between equal-shaped
worksheet tabs: React reused the cell, and the old focus receipt suppressed its
return. The field-registration funnel now retires that receipt on detach. The
browser assertion failed before repair. The preliminary verifier was stopped
before changing the tree; only final, uninterrupted acceptance counts for delivery.

## Completed checkpoint: complete current Artifact search

Commit `aa9db7b2` passed all five local verifier lanes (561 browser tests) and
the full 135-cell UI sweep with zero violations or skips, then was pushed to
`main`. Visual review was clean and Ada was left signed in. No GitHub CI was used.

Ordinary search previously matched only Artifact names, sources and short
excerpts, missing later Document paragraphs and structured body values. It now
searches each currently readable Document, Sheet, workbook and Slides body
through the same literal text projection used by saved-version search. Results
retain exact current identities, category order and complete paging, with a
bounded matching snippet shown in a three-line wrapped preview. No persistent
index, new route, authority or external service is introduced.

Current body reads reuse the canonical tenant/grant projection; foreign,
revoked and trashed bodies stay absent. History remains a separate owner-only
mode. HTTP regression tests reproduced the missing later-body matches before
implementation, and a source lock rejected the old preview wiring. Acceptance
covers later fields in every authored format, exact IDs, bounded Unicode
snippets, paging, edits, revocation, five-viewport owner/shared/foreign browser
walks, the complete UI sweep and the full local verifier on the final frozen
tree. The two pending product policy questions below remain outside this scope.

The first browser run exposed a missing global-search refresh on grant changes:
an already-open shared-reader result retained its snippet after revocation.
The common event handler now evicts every cached search query/category/page
before rechecking access (UI-196), locked by the failing browser assertion,
event wiring and actual cache-family eviction tests. Review also preserves
lazy historical snippet construction: off-page matches count without building
their previews. A duplicate Search-button test selector was corrected.

## Completed checkpoint: packaged saved-version workflow

The browser search/history checkpoint is complete. Prior packaged attachment
acceptance covered history restoration and API reads after relaunch, but not
explicit saved-version search or canonical revision pages in the built
renderer. The new acceptance uses an ordinary isolated desktop launch with real
OS-backed authentication and SQLite, generated accounts and authored content,
and no model/provider call or main-process injection. It proves owner search,
exact revision reload/comparison, inert Cancel, current-page navigation, shared
and foreign privacy, explicit restore, and signed-in full relaunch with exact
history and replay receipts. Its helper remains excluded from shipped code.
The focused packaged journey passed on unsigned arm64. A disposable copied
ASAR with saved-version query results disabled failed at the rendered exact
revision search result; the real package was untouched. All three helper locks
were watched fail against missing wiring/exclusion or weakened SQLite read-only
admission, then restored. Review corrected the post-relaunch search screenshot
to capture results before opening a hit. The complete packaged desktop smoke
then passed, and all eight final history screenshots plus the matching ASAR
digest receipt were reviewed without findings. The complete local verifier
passed all five lanes, including all 559 browser tests, without retries.
Commit `61d6b229` was pushed to `main`.
This is unsigned host-architecture workflow evidence, not signing/notarization,
native Intel or real-provider acceptance. The complete local verifier remains
mandatory before pushing. The Document identity and external Contribution
execution policy questions remain pending and outside this checkpoint.

## Completed checkpoint: explicit saved-version search

Ordinary search remains current-only. An explicit Search saved versions mode
finds literal text in the owner's retained Document, Sheet, workbook and Slides
bodies, including Trash. Queries are bounded to 256 UTF-16 units, pages to 20
hits and snippets to 320 units. No additional persistent index or external
service is introduced. Each result identifies its exact saved revision and
opens a canonical read-only history address, never a substituted current body.
Current-resource navigation, reload and Back preserve that distinction.
Comparison and separately confirmed CAS restore reuse the existing history
workflow; a restore from an exact-version address acknowledges the new current
revision without changing which saved revision the URL names.

Acceptance requires owner/shared/foreign and deletion tests, explicit-mode and
literal-match negative locks, exact-address navigation, paging and recovery,
five-viewport/accessibility review, the complete UI sweep and the full local
verifier on a frozen tree. Document stable-block identity and real external
Contribution execution remain separate pending decisions. Signing/notarization,
hosting, native Intel and authorized real-provider evidence remain release gates.

The first complete local verifier passed all five lanes and 559 browser tests.
Post-pass review found an unnecessary current-content library read on exact
revision pages; the UI sweep was stopped before repair. Shared read admission
now suppresses live reads on saved-body surfaces. A source lock failed before
repair, and the rendered walk counts network requests across opening, reload
and comparison. The corrected frozen tree passed all five verifier lanes and
559 browser tests; the final UI sweep passed 135/135 cells with zero violations
or skips. All five screenshot columns and ten explicit search/comparison views
were reviewed without findings. Commit `4f0927fd` was pushed to `main`, leaving
Ada signed in on the exact-version preview. This supersedes the preliminary run.

## Completed checkpoint: conversational Project sharing

This core-workflow checkpoint closed the missing named `share_project`
proposal tool over the existing sharing capability. The generic API door already
exposes this operation; no new route or sharing authority is introduced. An
explicit shared/private boolean and exact, unambiguous owned created-Project
target produce the normal consent card, which names public discovery and
contribution consequences without exposing private conversations or context.
Endpoint and Session transports share the tool and confirmation funnel.
The shared-reader browser walk caught an existing relation-card mismatch: Confirm
was visible to readers although the server denied it. All relation cards now
derive visible and callable consent from exact conversation ownership, retaining
readable proposal/history text. UI-193 records this demonstrated defect and lock.
Screenshot review also caught graph state overriding a previous Not now decision
after a later proposal was approved. UI-194 centralizes history precedence in a
pure verdict function, with a truth-table lock watched fail before repair.
Existing Agent tool grants are preserved rather than widened on upgrade; new
full-catalog Agents include `share_project`, and existing Agents may explicitly
select it through their normal configuration.

Strict-input and authority locks, model-to-route consent and replay checks,
Session-transport coverage, and five-viewport/accessibility review passed.
The final local verifier passed all five lanes including 555 browser tests;
the separate complete UI sweep passed 135/135 cells with no violations or skips.
Commit `2f234212` was pushed to `main`, with Ada signed in on the consent preview.

## Completed checkpoint: artifact history comparison

Owners can compare a retained version against the exact current saved revision
before deciding to restore it. The read-only comparison shows literal Document,
Sheet, workbook and Slides changes, distinguishes empty from absent values, and
pages every changed field in groups of 20. Workbook tabs retain their saved
identity; positional content does not invent moves. A newer current revision
requires explicit Refresh comparison before Restore becomes available again.
Restore remains a separately confirmed, revision-pinned operation. Trash history
can be compared but still cannot restore a body until lifecycle restoration.

This checkpoint requires the full local verifier, complete UI sweep and focused
five-viewport/accessibility browser acceptance on a frozen source tree. It adds
no API authority, model input or external integration. Signed/notarized releases,
native Intel and real external-provider acceptance remain separate release gates.
Adversarial review added a guard for version reads that reveal a newer current
revision before the history list/SSE arrives, plus success-state reset after a
restore. The exact-revision guard and literal projection both received negative
mutation checks. The initial UI sweep was intentionally stopped before edits;
acceptance must run again against the final frozen tree.
The complete 135-cell UI sweep and six focused comparison browser walks passed.
The first full verifier found one source-scan collision in an inert test string
(4,561/4,562 Node checks passed); the fixture was changed without weakening the
no-native-dialog rule, and the browser lanes were deliberately interrupted.
Follow-up review also keeps observed newer-revision evidence after leaving
comparison or changing selection. The final complete local verifier passed all
five lanes, including 554 browser tests; the final UI sweep passed 135/135 cells
with no violations or skips. Commit `f5012e14` was pushed to `main` after review,
with Ada signed in on the comparison preview. This evidence supersedes the
interrupted preliminary runs above.

## Completed checkpoint: conversation Find

After the verified paged-resource-search checkpoint, the next core gap was
finding text in older conversation history. Browser Find cannot see unloaded
messages. Conversation-scoped Find now uses a permission-checked paged read,
bounded snippets and exact-message navigation through the existing history
window. Shared readers use the same door; unavailable history has explicit
Retry/cancel and a removed or compacted target has a terminal explanation.
Current summaries are searchable; archived originals, attachments and tool
payloads are not. Global resource search remains title/preview based for sessions.

The checkpoint's delivery gates are the complete local verifier, UI sweep,
five-viewport/accessibility conversation-search browser walks, and signed-in
preview review. This is product-workflow progress, not a release-readiness claim;
signed/notarized distribution, Intel and real external-provider acceptance gates
remain. No GitHub CI is required or dispatched. The query/page guard was watched
fail when its page comparison was removed; the backend role lock likewise
received an intentional negative check. Unicode snippet behavior has dedicated
regression cases.

Adversarial review also found and corrected a doubled cache-family delimiter;
the actual cache eviction regression failed before repair. Open-dialog browser
checks cover new saved turns and revoked sharing. The initial broad Node run
observed a five-second native profile ACL helper timeout (4,549/4,550 passed);
its isolated 15-test suite passed, and no concurrent helper builder was found.
The fail-closed production check and deadline remain unchanged. Delivery still
requires the complete local verifier on the final revision.

The first full verifier passed static/build checks and 546 of 548 browser tests.
Two browser assertions needed alignment with the rendered structure: the
revocation alert includes its Retry button, and a current summary now has its
own addressable turn alongside the four retained originals. The strengthened
checks assert the alert/retry separately and distinguish summary from tail;
no production behavior, deadline or retry policy was relaxed. The final complete
local verifier passed all five lanes and all 548 browser tests; the UI sweep
covered 135/135 cells with no violations or skips. Reviewed and pushed as
`b373bf57`.

## Decisions in force

- Electron, distributed directly as signed/notarized Apple Silicon and Intel ZIPs.
- Preserve sign-in and personal MCP tokens across relaunch using an encrypted
  device signing root protected by macOS Keychain (approved 2026-09-06).
- Keep the HTTP/SSE contract portable to the later hosted service.
- Verify, review, commit, and push each completed checkpoint directly to main.
- The complete local verifier is the delivery gate (owner decision 2026-10-04).
  GitHub Actions is manual-only optional diagnostics, not a prerequisite or a
  routine monitoring task. Earlier CI references below are historical evidence.
- Follow the approved desktop defaults below. Ask before materially widening
  the supported external integration scope or changing an approved policy.
- Sequencing is delegated: all planned core capabilities remain required;
  prioritize complete, verifiable workflows without dropping later milestones.

### Approved desktop defaults (2026-10-04)

The owner explicitly approved all six recommendations. These are target product
policies, not claims of shipped behavior; implementation and acceptance remain
required. Earlier checkpoint evidence does not establish these policies as built.

| # | Area | Approved default |
| --- | --- | --- |
| 1 | Folder/Git access after relaunch | Offer explicit “Remember this connection”; retain the selected read-only connection until disconnected only when the user opts in. Otherwise require selection again after relaunch. Remembered access does not authorize writes or automatic model input. |
| 2 | Remote context freshness | Use saved snapshots with explicit Refresh, not automatic reads on every model turn. |
| 3 | Artifact deletion | Use recoverable Trash; permanent deletion is a separate, explicitly confirmed action. |
| 4 | Spreadsheet organization | Represent a workbook as one artifact containing tabs, with shared permissions and revision history. |
| 5 | Desktop updates | Check automatically; require user approval to install and restart. |
| 6 | Unsafe macOS profile permissions | Refuse startup, preserve data, and explain repair steps rather than silently rewriting permissions, including unsafe ACLs. |

This approval does not grant access to a particular local folder, authorize a
real deletion or profile repair, waive external-tool consent, or supply release
credentials. Signing/notarization credentials, download hosting, and native Intel
acceptance remain release prerequisites. Feature implementation must retain the
existing local verification, UI/native acceptance, and spec-ledger requirements.

### Approved follow-on decisions (2026-10-05)

The owner approved the three recommendations requested after the Folder checkpoint:

- Real Git context captures tracked working-tree files, including uncommitted
  edits, through explicit Attach or Refresh; untracked and ignored files stay
  excluded. Remember remains opt-in and access stays read-only.
- Bundle a pinned Git executable so end users do not need a separate Git install.
- Previous artifact versions are owner-only and retained without automatic
  pruning until permanent deletion. Shared readers see only the current version.

The owner subsequently approved permanent-deletion cascade semantics: remove the
artifact, all versions and shares, and artifact-only discussions/proposals;
preserve conversations, content-free audit/retirement records and existing backup
files. A later explicitly confirmed whole-backup restore can restore older
content; permanent deletion is not a promise of forensic erasure. This approves
the feature policy, not deletion of any real user artifact.
The owner also approved keeping original imported image files privately for later
download alongside their normalized preview/model copies. Original means the
selected source bytes, not another decoded frame. This applies to explicit local
and served-image imports; it does not grant new source access or send originals
to models/shared viewers. Implementation must account for both copies in storage,
backups and cleanup and preserve existing imports that have no retained original.
Approval alone does not establish implementation or release acceptance.

### Approved contribution review policy (2026-10-06 UTC)

The Project owner selects the reviewer Agent/provider and explicitly starts each
review using the owner's budget. The reviewer receives only the frozen changeset,
has no tools, and cannot land changes automatically. This approval does not
authorize delegated policy decisions, envelope fulfilment or a paid-provider
acceptance run using real credentials.

The explicit reviewer path now preserves private Project walls, owner-scoped
reviewer/provider resolution, budget preflight and usage attribution, exact
changeset identity, and separate human landing. An attempt commits before
provider I/O: retry or restart cannot silently repeat a possibly paid request,
and a late result cannot review a newer changeset. Pending, findings, passed,
failed, stale and uncertain outcomes have distinct public history. Existing
local usage counters are metering, not a strict reservation of concurrent or
unreported spend. Legacy reviewer omission remains a development fixture only.

### Approved OCR and Discussion attachment defaults (2026-10-06 UTC)

The owner approved both recommended defaults:

- OCR runs on-device. Extracted text is editable and must be reviewed and
  explicitly adopted before saving. Extraction itself does not upload an image,
  contact a configured provider or incur a provider charge.
- A Discussion attaches as an explicit saved copy. Attach and Refresh check
  current source access; the copy follows the destination conversation's sharing.
  The UI must warn before copying. Later source revocation does not erase the
  existing copy or prior replies. This is not a live permission-linked view.

The bounded macOS recognition engine is now connected to Document creation:
explicit single-image selection, on-device extraction, read-only text review,
explicit adoption into editable Content, then ordinary Create. Neither selecting
nor extracting saves or uploads the image; recognition never calls a provider.
Browser/other-platform OCR and scanned-PDF page rendering are not silently added
by the desktop image engine. Discussion-as-Context implements the approved
copy/sharing semantics under CTX-DISC-1, as scoped in the checkpoint below.

The internal engine locks recognize generated pixels with the real native helper,
including blank and malformed images. Packaged acceptance checks the shipped
single-architecture binary, system-only dependencies and ASAR-matched runtime.
The capacity lock was watched fail when cancellation released its child slot
before process close; the real helper lock also failed when malformed PNG framing
was misreported as no-text. Compressed metadata and APNG chunks are refused before
OS decoding. The renderer workflow adds account/operation fences and explicit
adoption; none of this establishes scanned-PDF extraction, complete
language/corpus accuracy or native Intel evidence.
Implementation uses Apple's [Vision text-recognition request](https://developer.apple.com/documentation/vision/recognizing-text-in-images)
with a fixed accurate revision and automatic language detection; accuracy and
language support are OS-dependent, not a promise of universal recognition.

## Progress and next milestones

### Complete resource-search navigation (2026-10-06)

The next core-workflow audit found that global search exposed only five matches
per category without continuation and dropped several selected resource IDs at
navigation. COMMONS-15 now keeps the small overview while offering fixed-size
category pages and exact canonical doors, including work items and prompts.
Each page reuses current authorized reads; live changes may shift offsets and
the UI says so. Artifact excerpts join the existing metadata/prose search;
full conversation transcripts and saved-version indexing are separate work.

The shared result mapper and response-coordinate guard prevent generic landings
and stale-query activation. Keyboard selection scrolls into view, read failure
has explicit Retry even beside local Pages, and the loaded palette now uses the
same viewport-bounded dialog as its deferred loading state. No index, persisted
search history, external connection or new write authority is introduced.
Acceptance covers exact paged IDs, HTTP/MCP parity, current access, canonical
resource doors, query races and five-viewport accessibility/layout. The complete
local verifier and responsive sweep remain the pre-push gates; no GitHub CI is
used. Contribution execution still awaits its separate design decision, and
the signed/notarized, hosting, Intel and paid-provider gates remain open.

The first focused browser run exposed 4.38:1 selected-result secondary text;
UI-189 now pairs that text with its tested chromatic seat across both modes,
presets and sampled customization extremes. Both browser and intentional pure
contrast regressions failed before repair. The first full Node run found an
existing message-metrics test exhausting the shared demo tenant's five-hour
budget (HTTP 429). That test now owns a fresh usage partition and proves a 200
plus terminal message before checking the counter; production limits and test
timeouts/retries are unchanged.

The responsive sweep completed all 135 cells with no violations or skips;
focused search/browser coverage passed 11 tests and the full Node suite passed
4,531 tests. Post-test review tightened the keyboard destination's heading
assertion to use the actual selected title, rather than an undefined name. The
final complete local verifier must include that strengthened assertion before
landing. The signed-in preview demonstrated a formerly hidden sixth artifact
opening its exact page and retained Ada plus the six-account stack.

The first complete verifier passed all four browser lanes but exposed a native
Git fixture collision: six concurrent suites compiled to the same development
helper path, while the failed reader suite passed alone. Each now builds an
identical helper into its own temporary directory with suite-owned cleanup;
the helper fixture is excluded from packaging. A source lock failed on all six
shared builds before migration. No production Git authority, reader behavior,
deadline or retry policy changed. The search race test also now proves its
response is held before attempting Enter.

### Literal Sheet range paste (2026-10-06)

ADAPT-40 adds bounded table paste to the shared creation and editing fields.
TSV quoting preserves literal values, and one validated replacement grows the
chosen worksheet without changing other tabs, notes or cells. Malformed and
oversized pastes leave the draft untouched. Immediate Undo is fenced by the
exact resulting body so a later edit from another pane cannot be overwritten;
normal Save/Create and Cancel still own persistence. CSV/TSV file import and
clipboard paste now share one parser instead of separate grammars.
The production bundle gate caught a 502,641-byte section dependency graph
against its unchanged 500,000-byte ceiling. Saved editing now loads on demand
behind announced local loading/failure, safe Cancel and explicit warned Reload;
the shared memory draft and creation-runtime admission remain authoritative.

Acceptance covers pure boundaries, creation/edit browser workflows at all five
viewports, the full local verifier and UI sweep, plus built-renderer paste and
source-independent relaunch in the unsigned arm64 package. The packaged paste
event is a generated fixture, not OS-clipboard acceptance. No GitHub CI is used.
MCP Contribution execution remains a separate pending design decision; release
credentials, update hosting and native Intel acceptance remain open.

### Actual native PDF review acceptance (2026-10-06)

The [native PDF record](acceptance/native-pdf-ocr-2026-10-06.md) adds actual macOS
chooser cancellation, blank-PDF refusal, two-page scanned recognition, separate
read-only review, explicit adoption/correction/Create, and exact saved text after
a full source-absent relaunch. Three ordinary launches used one generated private
profile, real OS storage, no debug/test bridges and native-menu Quit. Native
control state intermittently lagged; a clean relaunch restored the successful
selection. The uncompleted protected-PDF manual attempt is not counted as a pass.

The next core direction is real Contribution execution through a user-selected
tool on an existing MCP connection, with reviewed exact arguments, a separate
Run confirmation for each call and no automatic retry after uncertainty. That
design decision is pending; approval would not authorize any real external
action or credentials. Signed/notarized and native Intel evidence, public update
hosting and authorized real-provider acceptance remain external release gates.

### Sandboxed scanned-PDF review (2026-10-06)

The owner approved a separately sandboxed macOS service and continued independent
core work. Explicit single-PDF selection now feeds a byte-only broker and an
authenticated App Sandbox XPC service. Only the service links the native
CoreGraphics/Vision decoder; it has no user-file or network entitlement. The
Document form keeps recognized text in a read-only candidate until explicit
adoption, correction and ordinary Create. Limits are 8 MiB input, 100 pages, a
2,000-pixel rendered edge, 64 KiB whole text, one job and a 120-second deadline.
The existing 19,980-character source limit refuses larger candidates without
clipping. Every admitted page is processed sequentially, including blank pages.

The isolated browser bridge-fixture workflow now passes all 22 focused artifact
import journeys, covering PDF/image OCR, ordinary text/PDF/DOCX imports,
presentation/workbook imports and recovery. PDF idle, pending, review and refusal
states pass exclusion-free accessibility and containment checks at all five
canonical viewports, with both native OCR capabilities represented. The general
UI sweep passed 135/135 cells with no violations or skips. These establish
renderer behavior only, not native confinement or a release-ready PDF engine.
The initial browser run exposed two test defects (a rounded rather than exact
source-limit expectation and attempting an account switch behind a modal); both
were corrected without retries or wider timing budgets. Native picker payload
coverage also watched the incorrect byte-field mapping fail before repair.

The service validates its own sealed identity and authenticates the fixed broker
identifier and Developer ID team; local ad-hoc builds instead pin the exact
standalone transport signature. The broker validates its nested service before
connecting. The service exits on broker loss even with an uncooperative decoder,
and has an independent deadline. Real generated-file/loopback denial, forced
cancellation, wrong-peer rejection and tampered-seal tests passed; the denial
assertion was watched fail with a test-only unsandboxed service. Page bitmap
budgets do not claim to bound every internal decoder allocation.

The unsigned arm64 packaged OCR phases passed with actual two-page image-only
PDFs, blank/protected/over-page-limit refusals, exact review/adoption/correction,
and saved Document content after source-absent relaunch. Initial packaging
failures exposed the actual codesign requirement prefix and Packager hook path;
both are now covered by locks. Native picker answers are fixtures, not manual
OS-dialog evidence. Developer ID/notarization, Intel execution and broader OCR
corpus acceptance remain release gates. The complete `npm run desktop:verify`
passed, including the independent recovery repair below. The complete local
`npm run verify` remains the mandatory pre-push gate, without retries or GitHub
CI reliance. Ordinary PDF attachment/import stays explicitly text-only.

The first complete verifier passed all four browser lanes and 4,485 of 4,486
node tests. Its sole failure was the suite-path lint treating a quoted expected
renderer import as a path relative to the cross-layer test itself. That assertion
now uses the same exact import regex shape as the surrounding source locks;
neither the path lint nor its exceptions, product behavior, timing or retries
changed. The corrected complete verifier passed before commit `1d53e352`:
4,486 node tests and 527 E2E tests, all five lanes green without retries in
474.2 seconds. The production build and complete packaged verifier also passed.

### Actual startup restore and cancellation repair (2026-10-06)

The [native recovery review](acceptance/native-restore-2026-10-06.md) now proves
actual macOS selection/confirmation and Electron-managed automatic relaunch on
the unsigned arm64 package. The exact baseline Document returned after replacing
generated damaged SQLite; newer work was absent, the authentication root and
empty vaults stayed byte-identical, and no additional safety copy appeared.

The manual review found picker cancellation left the failed-start app running
without a usable window. Startup recovery now quits on picker or confirmation
cancellation and on failure, while an explicit restarting outcome leaves exit
to the restore lifecycle. Behavioral and wiring regressions were watched fail;
both actual cancellation paths now exit cleanly with generated damaged bytes
unchanged. The complete packaged verifier passed. Populated-vault/token recovery,
healthy safety-copy behavior and malformed-backup recovery remain covered by
their separate automated walks, not this narrower manual record. Signing and
native Intel acceptance remain open; no GitHub CI is used.

### Damaged-startup restore acceptance (2026-10-06)

The expanded packaged recovery walk uses only generated isolated profiles and
explicit dialog fixtures. It found a real gap: a valid portable backup could
not repair an unreadable SQLite database because restore tried to open the
damaged destination first. Recovery now stages and read-back-validates a new
SQLite database privately, retains the existing main file without an absent-path
crash window, separates old sidecars and atomically publishes the replacement.
Final-path read-back and durable rollback prevent false success. Orphan sidecars
without a main database remain a fail-closed manual-recovery case.

The new regression was watched fail against the old direct-open path. Focused
locks prove malformed input, staging failure and final-read-back failure preserve
the original bytes, including removal of replacement-created WAL/SHM files before
rollback. The real packaged damaged-startup walk now passes: exact chosen
Document/Sheet/Slides/conversation state, no fresh safety copy, unchanged device
authentication root and provider vault, and a still-usable pre-damage personal
token. Dialog answers, relaunch spawning and that walk's mock keychain are
explicit test fixtures, not manual OS-dialog or OS-encryption evidence. Separate
ordinary packaged launches still prove OS-backed credential/auth persistence.

### Captured possible-rename review (2026-10-07 UTC)

PORT-29 extends the read-only review with optional grouping of staged additions
and deletions. Unique identical text and conservatively scored edited text can
pair old HEAD with new Index; every suggestion remains a possible move because
copy-plus-delete is indistinguishable from these bytes. Ambiguous, unread and
over-budget edited candidates stay as raw rows. Unstaged changes remain separate,
and a fresh read or dismissed review resets grouping. This is a pure projection
of the existing capture, not native Git rename detection or a new API authority.

The duplicate-exact ambiguity guard was intentionally broken and its regression
failed before restoration; bypassing grouping also failed the rendered old-to-new
heading assertion. Independent cutoff and reverse-ambiguity mutations also failed.
Pure locks cover UTF-8 weighting, exact line endings,
input/work budgets and raw immutability. Browser acceptance covers opt-in/out,
old-path selection, fresh-read/disposal resets, no implicit reads or writes and
short/long paths across five viewports. Packaged acceptance creates actual staged
moves in an isolated generated repository and checks exact old/new sides,
unchanged index/sharedindex bytes and mtimes, saved context and model requests.
Complete local verification, the general UI sweep and unsigned arm64 desktop
verification remain required before landing; outcomes belong in the checkpoint
handoff. Signed/Intel and broader real-provider/service acceptance remain open.

### Changed-line Git review (2026-10-06 UTC)

PORT-27 turns the existing read-only Git capture into line-numbered changed
sections with three context lines, added/removed totals, newline cues, and a
Full files alternative. Rendering is paged at 200 text rows without dropping
later changes. Exact missing sides and unread sides stay distinct; unavailable
or excessively complex comparisons retain the captured full text and explain
why changed lines cannot be shown. View changes do not reread the repository.

The pure bounded matcher preserves CRLF and final-newline identity, handles
whole-file addition/deletion linearly and is checked by reconstruction and a
small-input minimality oracle. The byte-limit and unknown-side-as-empty
mutations were watched fail. Acceptance covers changed-line/full-file views,
pagination, long lines, mode-only and empty changes, omission/fallback, native
read counts, account disposal and the five-viewport accessibility matrix.
The complete local verifier, general UI sweep and packaged Git walk remain the
delivery gates. PORT-29 separately adds possible-rename hints; neither adds Git
writes, live status, model access, or signed/Intel evidence.

### Saved Discussion context (2026-10-06 UTC)

CTX-DISC-1 adds a confirmed saved-copy attachment to existing conversations and
new drafts. The picker uses the participating readable Discussions projection,
excluding direct messages; the server rechecks source access on Attach and
explicit owner Refresh. A complete transcript is bounded to 200 posts and
64 KiB and joins the ordinary shared attachment-input budget. Rendering never
fetches the source, and the saved copy follows destination sharing even after
source revocation or deletion. No tool permission is created by a Discussion.

First send replaces a queued target with the acknowledged saved copy before
adoption. Capture refusal preserves the exact retryable turn and its one created
conversation. An uncertain context write must reconcile the current desired
workspace and remove abandoned effect bindings before Retry can send; a removed
copy cannot survive a lost response and silently become model input. Reset and
account disposal fence late acknowledgement and failure publication.

Locks cover source walls, tamper refusal, strict durable snapshots, bounded
untrusted model framing, shared-reader restrictions, explicit Refresh and
lost-response recovery. Source-wall and draft-adoption mutations were watched
fail. The browser matrix covers picker, confirmation and owner/shared panels at
all five viewport sizes; the general sweep passed 135/135 cells with no skips
or violations, and all 142 general plus 20 Discussion captures were reviewed.
The shared picker workflow now loads on demand under the unchanged startup
budget, with local failure and Done recovery. The complete local verifier is
the final delivery gate; GitHub Actions is not used. Signed/Intel releases,
public update hosting and authorized real-provider/external-effect acceptance
remain separate prerequisites, not claims made by this saved-copy workflow.

### Packaged Discussion saved-copy closure (2026-10-06)

CTX-DISC-1 now has ordinary packaged-process evidence for the complete saved-copy
workflow, not only browser and route-level locks. The excluded
`desktop/discussionContextSmoke.mjs` sets up generated accounts and resources
through the shipped HTTP API, then uses rendered confirmation, Attach, Refresh,
send and detach controls. Its independent transcript oracle checks exact Unicode,
line breaks, author names, timestamps and reply relationships on the actual model
wire. The single provider conformance probe is accounted for separately from four
conversation requests; Attach, Refresh and relaunch do not dispatch model work.

Source edits leave the saved copy unchanged until explicit Refresh. A separate
real account sees the copy through destination-only sharing while the private
source remains 404, with no owner controls. Deleting the generated source branch
does not remove the destination copy. A full native-process exit leaves the exact
snapshot in SQLite; ordinary relaunch preserves sign-in, replies and the saved
open-panel preference before another exact saved-copy send. Detach removes new
attachment input while retaining earlier replies. No effect-bearing SessionContext
is created. The network assertion covers per-Discussion detail requests; the
explicit picker's participating-Discussion list remains its normal projection.

The focused unsigned arm64 walk passed on runtime ASAR
`892b8db100f67c2630c410c416b18d116916ed8459389c430777fc7dd095c620`.
A disposable copy with model `post_count` forced to zero failed the exact-wire
assertion (`0` versus `2`), while saved data and reply text still matched. The new
package-exclusion and awaited-smoke wiring locks also failed before implementation.
Per-run screenshots and hash-bound receipts live under the ignored
`.data/desktop-discussion-smoke/` directory; no test helper ships. The complete
local and packaged verifiers remain mandatory before landing; no GitHub Actions,
paid provider, signed/notarized or Intel acceptance is implied by this checkpoint.

The complete packaged verifier passed. The first full local verifier passed all
527 browser tests but exposed an existing 25 ms timeout-test race: the delegated
judgment fixture sometimes received no request before connection setup expired.
That test and its identical Contribution review counterpart now assert the exact
configured deadline and inject a timeout only after full request-body admission,
with a bounded admission watchdog and early-settlement failure. Both reject an
intentional production deadline mutation from 25 to 26 ms. Runtime deadlines,
retry policy and application behavior are unchanged. The repaired revision passed
all five local verification lanes, including all 527 browser tests. Post-test
review additionally pins the reader's source 404 after destination sharing, not
only before it; the final revision remains subject to the complete pre-push gate.

### Local image to editable Document (2026-10-06 UTC)

PORT-26 now completes the approved bounded macOS workflow. Extract image text
shares the ordinary Document import review and preserves any typed name/content.
The native chooser admits only one image; the normalized PNG alone crosses the
trusted main-frame bridge. The shared contract rejects diagnostic fields and
incomplete, invalid Unicode or oversized text. Explicit Use/Replace adopts the
candidate, the Content field permits corrections, and Create saves through the
existing acknowledged Document lifecycle. There is no image upload, original
retention, provider request or OCR-specific durable record in this path.

Cancellation, format change, account transition, navigation and shutdown fence
late work. Native child capacity remains occupied until process exit; an outer
renderer deadline also prevents an unanswered bridge from stranding the form.
The result-shape, sender-ownership, single-image admission and post-recognition
lifetime locks are deliberately mutation/failure checked. Acceptance gates cover
five-viewport review/accessibility, standard document/sheet/slides regressions,
the complete local verifier and general UI sweep, plus real packaged OCR from
generated PNG pixels and corrected Document content after a source-absent relaunch.
The full 517-test E2E suite, 135/135-cell responsive sweep, production build and
packaged OCR acceptance passed. Browser bridge fixtures establish UI wiring;
the packaged helper establishes recognition for this bounded macOS path.

Discussion-as-Context follows the separately scoped checkpoint above. PORT-28
now separately provides scanned-PDF-to-Document review. Browser/non-macOS OCR,
automatic OCR in ordinary PDF attachments and broader accuracy/language
acceptance remain distinct future work. Release blockers are still signed and
notarized Apple Silicon/Intel evidence, public update hosting and authorized
real-provider/external-effect acceptance; no GitHub CI dependency is introduced.

### Actual native Git review and update notice (2026-10-06 UTC)

The [revision-scoped native acceptance](acceptance/native-git-review-2026-10-06.md)
now covers the real macOS chooser and PORT-25's explicit staged/unstaged review,
freshness, Dismiss, missing-source Retry and durable Disconnect across three
ordinary launches. The remembered connection survives while transient results
do not. Exact generated index/shared-index hashes and timestamps remain unchanged;
no provider was configured and the session registry stayed empty. The actual
application menu and unconfigured-update notice were also visually reviewed.
No product source, native policy, normal user profile or shared demo state changed.
This closes those unsigned arm64 manual cells, not signed update consent,
two-version installation, Intel or paid-provider acceptance.

The existing Discuss with Claude action still seeds a digest into a new
conversation; reusable Discussion attachments to existing conversations have
been implemented separately under CTX-DISC-1. Its current-source read check,
saved snapshot and destination-sharing behavior follow the approved
explicit-copy policy and checkpoint above. The OCR choice
above is approved and its bounded macOS implementation and acceptance are
complete; configured-model uploads are not authorized by that decision.

### Explicit local Git review (2026-10-06 UTC)

The existing repository page now exposes an explicit **Review changes** read,
with separate staged (HEAD → index) and unstaged (index → working tree)
comparisons. The shared diff primitive shows complete bounded before/after text,
executable mode, absent/empty files and explicit omissions. Read time and raw-byte
limits stay visible; this is neither live Git status nor a line-hunk/rename engine.
Review is account-scoped memory only: no saved snapshot refresh, model input,
HTTP mutation or Git write is implied. Dismiss, disconnect and account switches
fence late replies. Native snapshot/review operations share capacity and shutdown
revocation; the portable parser validates and detaches every publication.

This completes the user-facing read-only baseline workflow over the internal
foundation below. Signed/notarized two-architecture release, external-service and
paid-provider acceptance, OCR, and richer source/format workflows remain separate
production milestones. Local verification and browser/native acceptance remain
the checkpoint gate; GitHub Actions is not used.

Checkpoint evidence: all seven focused Git browser journeys pass, including
five-viewport ready/empty/omitted/error/loading/dismissed states, bounded keyboard
code scrolling, navigation retention, account disposal, malformed output and
lazy-module recovery. The general sweep covers 135/135 cells with zero skips or
violations; all 142 captures were visually reviewed. The complete unsigned
arm64 desktop suite passes, including actual bundled-reader/preload/renderer
review, unchanged index/sharedindex bytes and timestamps, saved-only model input,
relaunch and disconnect. This is not signed/Intel or real-provider acceptance.

### Read-only Git diff foundation checkpoints (2026-10-06 UTC)

The real Git baseline review rests on these completed prerequisites, not a
comparison of saved snapshots. Its first layer adds internal no-follow object range reads and
fixed-depth pack-index discovery to the existing native helper. Exact slices are
bounded at 16 MiB even when a pack is larger; every result carries the whole-file
version, and an out-of-range request cannot silently return partial bytes.
Only canonical SHA-1/SHA-256 object paths are accepted. Pack discovery excludes
alternates and unrelated names, and both operations recheck descriptor bindings.

The internal baseline transaction now resolves real detached, loose or packed
HEAD references and preserves staged/unmerged index identities, including
SHA-1/SHA-256, split indexes, unborn branches and linked worktrees. Git decodes
loose and packed/delta objects only in private generated metadata; source paths,
configuration, hooks and alternate stores never become Git execution authority.
Pack/index checksums, independently hashed returned objects and final source
version/root fences protect publication. Metadata-only probes explicitly return
unverified hints; they cannot establish content integrity. Limits include
500 paths, 64 tree levels, 1 MiB/object, 8 MiB decoded bodies, 32 MiB pack indexes,
512 MiB staged object data and a 30-second operation lifetime. Regular baseline
blobs retain the shared 64 KiB bound. Private staging is removed on normal exit;
forced-crash cleanup is not yet claimed.

Packaged acceptance now exercises generated packed HEAD/index baselines through
the actual bundled Git and descriptor helper, checks unchanged source metadata,
and byte-compares the baseline modules/dependencies against their ASAR copies.
This is internal-library acceptance, not product IPC, native selection or diff UI.

The internal review reader now combines HEAD, index, current ignore rules and
working-tree reads under the same final fences. It reports staged and unstaged
raw-byte/mode changes separately, distinguishes missing files from unsupported
or unreadable ones, and never presents sparse subtrees or skip-worktree leaves
as deletions, or an unmerged index as a normal comparison. A generated private
sparse cone preserves captured sparse-directory entries without source rules;
tagged index enumeration retains leaf skip-worktree state. A path deleted from the index grants
no access to a recreated, now-untracked working file. Ignored paths are excluded
before any baseline/working body reads. The shared private ignore helper now
also serves existing saved captures, with 64-level/1,024-directory limits and
32 KiB candidate batches. File/directory transitions use conservative directory
ignore matching, which can exclude an additional historical file rather than
expose an ignored subtree.

Working input remains limited to 24 readable files/128 KiB; display text across
all sides is separately capped at 128 KiB, with 64 KiB per body. Staged changes
receive first access to the bounded preview; every remaining omission is
explicit. Comparisons are literal bytes and owner-executable mode, not a promise
to reproduce Git status with source configuration, attributes, line-ending
conversion, clean/smudge filters or external drivers. This reader adds no source
writes, automatic reads, renderer bridge, saved-context schema or model input.

PORT-25 now connects this transaction to the explicit local review surface above.
Source Git configuration, external diff drivers, untracked/ignored files and
repository writes remain excluded. Persisting, sharing or sending this review
to a model needs a separate product decision.
At that review checkpoint the OCR choice was still pending; it has since been
approved, implemented as PORT-26, and accepted for the bounded macOS path. The
signed/paid-provider release gates remain pending.

### Packaged delegated judgment acceptance (2026-10-06 UTC)

The unsigned arm64 packaged workflow now covers delegated judgment through the
ordinary Electron executable, real OS-backed authentication and SQLite. It
reuses the existing local Messages fixture and generated profile; no credentials
or user workspace are involved. Rendered Draft keeps work open. The exact wire
contains only policy, changeset/envelope and structural risk, without tools,
Project/discussion context or Agent instructions. Review instructions remain
allowed for the separate review path, so independent test markers distinguish
those two input boundaries.

A second judgment is observed pending on disk before and after shutdown. An
independent launch durably records uncertainty while retaining the first result,
owner identity and exact usage windows. The captured body/key returns that
receipt with no provider redispatch. Explicit promotion to policy revision one
does not execute; a new rendered Decide lands the permitted non-effectful work.
A separate Decide approves a read-only envelope without landing or fulfilling
its lines. The actual managed backup retains both private judgment histories.

The focused walk passed eight fixture requests with six completed responses and
996 reported tokens in each usage window. Its ordinary package ASAR hash was
`a00e01c32048fcb69d3f80ba35cba0f82819f60c6129c5f190835d1da9c93210`.
Removing judgment recovery in a disposable package copy failed precisely at the
rendered uncertain-state check after relaunch; the altered copy was removed and
the ordinary package hash stayed unchanged. Fixture recognition and acceptance
source locks were also watched fail and restored. The complete desktop smoke
passed its startup, credential, native-import, Git, schema and restore phases.
The complete local verifier remains the final delivery gate. Paid-provider, signed and
native Intel acceptance, and real external-effect fulfilment remain outstanding.

### Real delegated judgment implementation (2026-10-06 UTC)

The approved owner-started model path now uses an exact policy/work/reviewer
request and commits its pending receipt before provider I/O. It sends only the
written policy, frozen changeset/envelope and structural risk, without tools or
Agent instructions. Draft recommendations do not act. Decide can approve only
a read-only envelope or land non-effectful work after policy revision, expiry,
revocation, ownership, provider binding and all frozen work/risk facts are
rechecked. Irreversible work escalates before model I/O. Refusal and escalation
are distinct outcomes, including in the attention ledger.

Model explanations remain initiating-owner-only because they can quote private
policy. Shared readers see attributed status and content-free timeline acts.
Same-key recovery returns the exact durable attempt; restart converts pending
to uncertain without another call. A fresh paid attempt always requires a new
explicit activation. Local fixture verification and browser review precede this
checkpoint's delivery; packaged native judgment acceptance remains the next
release gate. No paid-provider run or external envelope execution is implied.

Adversarial review repaired model-label/ID receipt confusion, delayed approval
overwriting newer envelope usage, and a failed lazy load stranding later held
intent. Independent guards were watched fail and restored. Compatibility tests
also exposed a consumed request body being read twice; the legacy wrapper now
receives the already-parsed body, with a bounded regression lock. Real pending
attempts are observed on JSON/SQLite disk before a fixture response, survive an
abrupt child-process exit, and recover to uncertainty in a fresh process. The
comprehensive snapshot exercises a completed judgment through the actual store
mutator and retains history after its temporary authority is removed.

### Approved delegation lifecycle and judgment policy (2026-10-06 UTC)

The owner approved both pending defaults: real delegated judgment is explicitly
started by the Project owner on their own budget, with no tools and only the
written policy, frozen changeset/envelope and necessary risk facts. Draft mode
is advice; Decide mode may approve a read-only envelope or land a non-effectful
Contribution only after current authority and exact versions are rechecked.
Irreversible actions always return to the human. Uncertain requests never retry
automatically. Delegation policies support explicit versioned edits and expiry;
changing or expiring a grant invalidates any unfinished decision's authority.

Implementation is staged at complete checkpoints: first the owner-facing policy
lifecycle and durable version/expiry boundary, then the separately metered model
judgment seam and native acceptance. This approval does not authorize a paid
provider acceptance run, external-effect execution or signing credentials.

The policy lifecycle now retains the original grant and up to 49 explicit edits,
including policy text, autonomy, triggers and expiry, privately for its owner.
Agent and act identity stay fixed. Editing requires the original delegator's
current Project ownership and exact reviewed version; retry proves the retained
next-version payload and returns current truth without reverting later edits.
Expired grants remain readable and revocable but authorize no new judgment.
Revocation pins both grant identity and policy revision. Legacy immutable grants
retain revision-zero meaning and no expiry.

The editor keeps unsent policy and uncertain requests across navigation, exposes
exact Retry or explicit Dismiss/review, and never rebases authority silently.
The boundary tests include owner/shared/foreign projections, stale writes,
bounded history, expiry, JSON/SQLite restart and unchanged release refusal.
Adversarial review caught two persistence admission gaps: unknown row fields
could enter shared projections, and a fabricated retirement receipt could
acknowledge revocation while authority remained live. Strict row/receipt
admission now rejects both, with each lock watched fail against its disabled
guard. This checkpoint does not yet enable real delegated model judgment.

The UI review also corrected duplicate-pane draft divergence and aligned Edit
and Revoke with their distinct server authority rules. All open editors now
observe one memory-only draft; the original delegator may edit only while still
owning the Project, while either the delegator or current owner may revoke.
The final full visual sweep covered 135/135 cells without violations or skips;
focused browser checks cover held navigation, lost responses, explicit
stale-policy review and synchronized duplicate panes. Two full-verifier runs
then exposed a deferred-section layout regression during a neighboring Land
click. The retained trace identified the swap during the pointer action; a
delayed-module test reproduced a 21-pixel shift. Loading and failure now retain
the shared folded-section anatomy, with held-pointer and local-recovery locks.
The complete local verifier remains mandatory before landing; no GitHub CI is
used.

### Packaged owner-review lifecycle acceptance (2026-10-06 UTC)

The rebuilt unsigned arm64 application now has a dedicated acceptance phase in
the ordinary desktop and extracted-release smoke. It uses an isolated generated
profile and the real OS-backed authentication root, production renderer, HTTP
service, Messages client and SQLite; only the local Messages peer is a fixture.
Rendered review controls produce findings and a pass without landing. The wire
contains only the frozen changeset and no tools, and completed replies meter
exactly the fixture's reported usage.

An unanswered third request is observed as pending in the real database before
and after app shutdown. A new process commits uncertainty, retains both earlier
results and exact usage windows, and answers the original keyed request without
another model call. Only an explicit fourth review dispatches again; a separate
human Land completes the workflow. The actual managed backup preserves all four
private receipts. Package-hash-bound evidence and screenshots are emitted under
`.data/desktop-review-smoke/`; no real provider credentials or user data are used.

The focused packaged walk passed. To verify the acceptance lock, a disposable
copy of the ASAR was changed to leave the interrupted receipt pending: its
relaunch failed at the expected rendered uncertain-state assertion. The altered
copy was removed; the ordinary artifact was unchanged. Fixture tests also catch
scoped finding corruption, and package exclusion tests reject shipping either
acceptance helper. Harness review additionally reproduced an unhandled rejection
when socket failure preceded late assertion attachment; the rejection assertion
now attaches before shutdown. The complete desktop smoke also passes its ordinary startup,
credential, attachment, schema-worker and restore phases. The complete local
verifier remains the final pre-push gate. This does not close signed/notarized, native Intel,
paid-provider, delegated judgment or external-effect milestones.

### Owner-controlled contribution review (2026-10-06 UTC)

The Contribution page offers an explicit eligible Agent selection and discloses
its configured endpoint model, frozen version and owner-funded budget. The
reviewer receives only that changeset plus its selected review instructions;
the separate Messages call declares no tools, performs no fallback or automatic
retry, and has bounded input, output and deadline. Strict entry-bound JSON
findings or a no-findings verdict enter retained review history, not discussion
comments or automatic landing.

A private exact-version/reviewer receipt commits before outbound I/O. Same-key
replay returns current receipt truth even if reviewer configuration later
changes; changed intent conflicts. A restart durably changes unfinished work to
uncertain. Invalid completed output still meters reported usage; ambiguous
transport has no passing authority. A new version or newer unsuccessful attempt
cannot borrow an older pass. Public history includes display attribution and
results, never tenant anchors, credential references or endpoint configuration.

Verification covers deterministic local Messages fixtures, owner/shared/foreign
boundaries, immutable retry intent, separate landing, and JSON/SQLite/portable
state. It does not claim paid-provider or signed-package acceptance. Delegated
policy judgment and envelope fulfilment remain independently release-blocked;
neither is implicitly authorized by this reviewer policy.

The responsive sweep covered all 135 cells without violations or skips, with
separate owner/shared review screens at all five canonical viewports. Its new
long-label check caught and locked a 320px disclosure overflow. Final review
also requires uncertain billable holds to survive failed Dismiss truth reads,
failed controller loading to retain visible recovery, and malformed provider
usage to settle uncertain rather than pass unmetered or remain pending forever.
These are explicit regression cases in the focused review suites. The local
preview retains the walkthrough and findings after its temporary fixture Agent
and provider are removed; no dead endpoint is left available for selection.

The first complete gate passed 4,198 Node tests and all four browser shards,
then rejected the new section bundle at 507,460 bytes against its unchanged
500,000-byte async-graph ceiling. Review history and controls now have a dedicated
deferred boundary: both display and the actual shared write runtime must load
before intent can be accepted. Loading dispatches nothing; a rejected module
offers explicit full reload with an unsent-text warning, not a same-URL retry
that the browser module cache cannot recover.
The emitted graph exposed a shared `CircleX` icon assigned to the section chunk;
using the already-shared alert icon for the red Failed state removes that
dependency. The budgeted build passes without changing its ceilings, and the
deferred review panel itself is 9.09 KB.

### Actual native image chooser acceptance (2026-10-06 UTC)

The [native image record](acceptance/native-images-2026-10-06.md) now adds actual
macOS Files cancellation, Files and Photos SVG selection, distinct same-name
assets, native original-file downloads and source-absent relaunch on the unchanged
unsigned arm64 package at `da395674`. Exact originals and normalized model-image
hashes match across the recorded checks; saved workspace, context and message
hashes match across a full Quit/relaunch. Only generated images, an isolated
profile and a credential-free loopback model fixture were used.

This closes the local SVG picker/original-download handoff gap for this artifact,
not signed/notarized, Intel, Photos-library, all-format, multi-account or
paid-provider acceptance. The normal six-account Ada preview remains untouched.
Owner-controlled contribution review is recorded in the checkpoint above;
real delegated judgment and envelope fulfilment remain independently unavailable.

### Contribution execution release wall (2026-10-06 UTC)

The current audit found three development fixtures outside the existing model
and connector release guards: contribution review always passed, delegated
judgment always found policy satisfied, and effect-envelope execution recorded
success without calling an external adapter. Desktop/web profiles now refuse
all three operations before new state or fixture receipt replay. The same store
wall protects internal callers; HTTP and MCP expose the ordinary
`capability_unavailable` refusal behind the Project visibility boundary.

Historical timeline entries remain readable. Their mock review stamps no longer
appear as effective review on an open release contribution or authorize Tier-1
contributor landing. Attention guidance directs the contributor to the Project
owner instead of promising a mock self-landing, and release advice no longer
proposes an unavailable delegated reviewer. Manual owner approval and landing
remain intact; approving an envelope is not a claim that its effect ran.

This closes a false-success defect, not the underlying production feature gap.
The explicit owner-selected review path is now recorded above; delegated policy
evaluation and envelope effect fulfilment remain required core work. A configured conversation provider or
connector does not silently configure these seams or approve paid acceptance.
Direct-store and route regressions were watched fail against the old behavior
before implementation; focused tests cover both release profiles, old fixture
receipts, unchanged state/events, private Project walls and the human path.
Disabling the shared release guard after implementation made six tests fail,
including the real MCP tools/call regression; the original guard was restored.
Complete local verification and final diff review remain the landing gate.

### Prior attachment and native acceptance checkpoints

The preceding checkpoint closed the actual macOS Git chooser acceptance gate on
the unchanged unsigned arm64 build at `a4212731`. The
[dated native record](acceptance/native-git-2026-10-06.md) covers real selection
and cancellation, explicit temporary/remembered grants, Attach, saved-only model
input, opt-in persistence, explicit Refresh, missing-source recovery and durable
Disconnect across four ordinary launches. Exact saved state and model-input
comparisons pass; split-index/shared-index bytes and nanosecond mtimes remain
unchanged. Only generated repositories, an isolated profile and a credential-free
loopback model fixture were used. Native-control limitations are recorded without
turning unresponsive actions into passes. No product code changed in this check.

The previous checkpoint implemented approved private original-image retention
and authenticated download. Explicit local and served imports bind the exact
source container and normalized copy to one immutable asset identity. Original
bytes count toward quota and cleanup, survive JSON/SQLite and portable backups,
and are downloadable only by the owning tenant; shared views and in-session
models retain only the normalized representation. Legacy imports remain valid.
The UI checks original availability before offering download and fences pending
reads across selection/account changes. Focused regression tests cover exact
bytes, original-private metadata, body budgets, acknowledgement validation and
restart. Original metadata and body responses are no-store; source containers
download as opaque files, never as inline image markup.

Focused browser acceptance passes all 28 image/collection workflows; the eight
new original-file workflows also pass after the final shared-view copy repair.
These cover exact SVG/ICO/PNG bytes across reload, legacy imports, owner/shared/
foreign walls, availability/body failure and retry, revocation, delayed selection
and account switches, and served-image capture. The frozen responsive sweep
passes 135/135 cells with zero violations or skips. All 137 fresh sweep captures
and 20 image-specific captures were visually reviewed across five sizes; five
older artifact-viewer PNGs were excluded from this revision's evidence.

The rebuilt unsigned arm64 package passes attachment acceptance, including an
actual original-file download with the exact filename/bytes before and after a
full relaunch with source files removed. Model image blocks remain normalized.
Native selection results and model responses in this automated gate are fixtures.
The separate native image record above now covers actual local Files/Photos SVG
selection and original download; the earlier Git record is not substituted for it.
Review corrected private-download vs model-input disclosure, stale intake copy,
shared-reader send wording, error contrast and invalid deferred rail-status
nesting, with failing-then-passing locks (UI-129, UI-179, UI-180).
The live preview remains on Ada's original-image walkthrough with all six demo
accounts stacked. The complete local verifier is the mandatory final landing gate;
no GitHub CI is used.
Signing/notarization credentials, hosting, native Intel and real signed updates
remain separate release gates. No public production-release claim is made.

The preceding checkpoint implemented the approved permanent-delete workflow from
Trash: a separate owner-only consequence preview and confirmation, exact reviewed
state held through recovery, one atomic cascade, and durable retirement that
prevents old saves, create retries or routine writes from resurrecting a deleted
artifact. Current content, retained versions, shares and recursively artifact-only
discussions/proposals are removed together. Conversations, audit records and
existing backups remain; explicitly restoring an older whole backup is an
intentional rollback exception, not a secure-erasure guarantee.

The owner-only HTTP/MCP capabilities use the same reviewed lifecycle/cascade
precondition and durable exact retry receipt. A lost response retains one
display-only Trash row through navigation; Retry never rebases the confirmed
scope, Dismiss only reads, failed reads retain recovery, and late responses cannot
redirect a newly chosen page. Private history/body caches are removed, stale
live acknowledgements cannot resurrect the identity, and former readers receive
an ID-free access-change hint. Deferred controls wait for their recovery module
and contain loading failures without losing Restore. Optional backup controls
load only in Customize, keeping the unchanged startup and async bundle budgets.

Focused browser acceptance passes all nine deletion workflows, including module
refusal, stale consent, lost acknowledgement, exact retry and owner/shared/foreign
walls. The separate responsive sweep passes 135/135 cells with zero violations
or skips; all 142 sweep screenshots and ten new confirmation/recovery captures
were visually reviewed across five viewports. The rebuilt unsigned arm64 package
exercises Cancel, explicit reviewed deletion, a full relaunch, absent history,
exact receipt replay and preserved conversations. JSON/SQLite restart and portable
backup tests cover retirement, failed durable commits and explicit older-backup
rollback. The complete local verifier remains the mandatory final landing gate;
no GitHub CI is used.

Adversarial review locked one graph revision per cascade, generic reader
invalidation, direct-create provenance independence and orphaned social-reference
refusal. Incidental notification reads do not invalidate consent; changes to the
artifact, versions, sharing or discussions still require fresh review. Retirement
admission accepts lawful large descendant sets rather than writing a record that
would fail on restart. Regressions were watched fail before repair.
The first complete verifier passed all four browser lanes but found the old Trash
and history source locks still requiring their prior guards. They now explicitly
require the deletion hold, its history exclusion and both lifecycle/deletion row projections. The
three module-refusal browser cases use separate declarations so the unchanged
coverage planner counts each case. The corrected complete local verifier passed
all five lanes, including 490 browser tests, before `a4212731` landed. The separate
135/135 UI sweep and rebuilt unsigned arm64 packaged gate also passed.

The live preview remains signed in as Ada with all six demo accounts stacked,
on an active disposable deletion walkthrough; no real user artifact was purged.
That checkpoint left native Git chooser acceptance open; the current dated record
above supplies actual OS-dialog evidence without substituting packaged fixtures.
Original-image retention was approved but not yet implemented at that checkpoint;
the current checkpoint above supplies it. Signing/notarization
credentials, download hosting, native Intel and signed update acceptance remain
separate production gates.

The preceding checkpoint implemented owner-only retained Artifact history. Each saved body
revision remains inspectable through the canonical Artifact page and the
same authorized HTTP/MCP capabilities. Explicit restore creates a new current
revision; it never rewinds ordering or erases intervening work. Its reviewed
current revision and selected source remain fixed through acknowledgement
recovery. Shared readers and ordinary model input continue to receive only the
current body. Owners may inspect retained history in Trash, but must restore
the artifact before making a body version current again.

The rollout cannot reconstruct versions that were never stored. The first
history-aware replacement retains the then-current body as a baseline with an
unknown original save time, and subsequent editor, proposal and routine writes
retain their versions without automatic pruning. History belongs in JSON,
SQLite and portable backups with strict admission and the same exact Artifact
identity. Permanent deletion and its retention cascade remained a separate gate
at that history checkpoint and are implemented by the current checkpoint above.

Focused acceptance passes all seven history browser workflows, beside the
body-edit and Trash regression coverage.
The responsive sweep passes 135/135 cells with no violations or skips; all five
columns and 55 history-specific captures were visually reviewed. The rebuilt
unsigned arm64 Electron package passes its complete smoke gate, including a
reviewed version restore, full relaunch and exact retry without another version.
JSON/SQLite restart and portable backup tests retain exact history and receipts;
portable admission rejects orphaned versions and forged ownership before writing.
The complete local verifier remains the final landing gate. Native dialogs and
model responses in packaged automation remain fixtures; this is not signed,
Intel or paid-provider acceptance. No GitHub CI is required or used.

Review reproduced a history Retry callback receiving a DOM event as display
text, pagination losing a loaded boundary after a live edit, and reconciliation
mistaking metadata resemblance for an exact restore receipt. Shared zero-argument
recovery callbacks, stable page merging and read-only Dismiss now have regression
locks watched fail before repair. Deferred history rendering and one shared
active/Trash section keep the unchanged startup and async bundle budgets passing.
Owner/shared/foreign browser checks preserve current-body-only sharing and model
input, fixed restore consent, navigation recovery and late-account fencing.
Final review also found an unguarded lazy recovery notice: the shell now contains
module failures without dropping the workspace, and history admission waits for
that same recovery module before accepting intent. Root/notice refusal walks
preserve typed drafts, refuse premature restores and recover only on explicit
warned reload across all five viewports. The admission source lock was watched
fail before repair. The first full verifier passed all 480 browser tests but
failed the canonical API-path parity lock; history now uses the shared registry.
Sharing its repeated URL encoder preserves all builder outputs and keeps the
new recovery boundary within the unchanged cold bundle limit. The corrected
135/135 sweep and rebuilt native gate pass. One verifier attempt overlapped the
sweep's port 5193 and could not start a browser lane; its other lanes passed,
but it is not a complete pass. The final standalone verifier passed all five
lanes, including 481 browser tests, before the history checkpoint landed as
`7d8d7ba4`; the separate sweep and rebuilt unsigned arm64 gate also passed.
That checkpoint left the preview on the version-history walkthrough with Ada active and the
six demo accounts stacked. The separately requested permanent-deletion policy
was then explicitly approved for the current implementation checkpoint.

The preceding Git checkpoint is committed and pushed as `dbfbb109`. Its final
complete local verifier passed all five lanes, including 474 browser tests;
the separate UI sweep passed 135/135 cells, and the rebuilt unsigned arm64
Electron package passed its complete smoke suite. No GitHub CI was used.

That Git checkpoint connected the approved native workflow end to end:
Repository → This computer offers an explicitly selected read-only connection,
Remember is opt-in, and Attach/Refresh saves bounded current tracked text through
the same portable workspace/model-input boundary. Contexts exposes symmetric
connection rows and an account-local Disconnect page. Saved copies survive lost
source access, disconnect and relaunch; opening and sending never read the source.
Repositories above 500 tracked entries refuse capture; smaller repositories keep
up to 24 readable files at 64 KiB/file and 128 KiB total, with omission reasons.
Nested paths and uncommitted edits are retained; untracked files and matches from
`.gitignore` / `.git/info/exclude` are excluded. Other local/global Git configuration
does not participate. Live diff/terminal, Git writes and hosted Git remain separate.

Native review found that even read-only Git enumeration freshens split-index
mtime. The implementation therefore runs pinned Git only on private copied
metadata and a generated worktree. A bundled descriptor-relative reader refuses
symlink traversal and changed root/file bindings; bounded metadata never enters
renderer or portable state. SHA-1/SHA-256 and optional zero-checksum indexes,
linked worktrees, source mutation, cancellation and account/grant isolation have
focused tests. UI review caught unbounded repository intake and misleading
truncation copy: the existing shared scroll body keeps Done outside, and one
limits disclosure supplies honest policy to intake, management and saved preview.
The four focused browser journeys pass, and the responsive sweep covers 135/135
cells with no violations or skips; all five screenshot columns and 25 dedicated
Git workflow screenshots were reviewed. The unsigned arm64 packaged workflow
passes actual capture, unchanged index/shared-index bytes and mtime, remembered
relaunch, saved-only model input, missing-source recovery and Disconnect. Final
review caught case/HFS aliases bypassing the literal metadata-path guard; the
new regression was watched fail before rejecting those aliases and disguised
dot traversal at both native enumeration and portable ingress. The complete local
verifier and rebuilt packaged run passed the final landing gates described above.
Native OS-dialog, signed/Intel and paid-provider acceptance remain separate gates.
Owner-only retained artifact history follows this accepted capture workflow.
No GitHub CI is required or monitored.

The preceding Git checkpoint built the approved bundled-executable prerequisite. macOS
packaging builds the checksum-pinned upstream Git 2.56.0 source for the explicit
target architecture using only Apple's toolchain and system libraries. Source,
license texts and an exact build recipe accompany the executable outside ASAR;
build inputs and acceptance helpers stay excluded. The source archive is sealed
as app data, while the Git executable remains in normal hardened-runtime signing.
Review removed the generic Electron JIT entitlement from standalone Git; its
empty entitlement set retains signing and hardened runtime. A disposable ad-hoc
signed copy passed strict verification and execution, not Developer ID/notarization.
Package and extracted-release acceptance verify source/license identity, binary
architecture/version and link dependencies, then enumerate tracked files in a
generated repository without changing its index or metadata. That foundation
did not yet connect a user's repository; the current checkpoint adds the capture,
remembered access, Attach/Refresh and saved-only model workflow above. Native
Intel and signed release evidence remain separate gates.

Both source builds passed their architecture/system-library checks; only arm64
was executed here. The rebuilt unsigned arm64 app passed the complete native
smoke suite and the first local verifier passed all 470 browser tests. Checksum,
architecture, signing-exclusion and JIT-entitlement regressions were watched
fail their locks. A repeat packaged run timed out when the Folder recovery walk
reset from desktop to phone and selected closing controls before the requested
tier settled. The harness now reuses its existing exact-tier/geometry readiness
check after that reset; no product behavior, retries or timeouts changed. Landing
requires the complete local verifier and packaged acceptance on the corrected
tree, with their outcomes recorded in the checkpoint handoff; no GitHub CI is used.

The current checkpoint repairs native Folder recovery observed in the recorded
macOS walk. A closed native outcome preserves busy and connection-limit guidance,
while the sandboxed preload converts failures into fixed path-free messages
instead of exposing Electron's IPC wrapper. Successful list, Connect, capture
and Disconnect keep the existing renderer API and account fences. Unknown native
exceptions and malformed replies retain the generic unavailable message; no new
filesystem authority, automatic retry, capture or saved-state mutation is added.
The new packaged missing-source regression was watched fail on the previous app
at the exact wrapped message. The host/preload tests likewise failed before the
repair, then passed. All 229 desktop tests and the rebuilt unsigned arm64 package's
complete smoke gate pass. The missing-source journey verifies exact workspace
preservation through Use saved state and retains saved-only model input. All five
recovery screenshots were reviewed after reusing the existing exact-tier,
ancestor-opacity and stable-geometry helper; the first captures caught motion,
not a product defect, and were replaced. No renderer component or layout changes
are included. The complete local verifier remains the final landing gate;
actual OS-dialog, signed/Intel and paid-provider acceptance remain separate.

The current implementation closes a first-run catalog mismatch found during the
native Folder walk: clean profiles had empty saved Contexts but the two Add
controls still offered bundled demo accounts and repositories. Both now read one
server-owned catalog selected by the persisted world. Demo fixtures stay explicitly
labelled and remain available in established demo stores; clean stores expose no
fixture candidates, including model connector-name lookup. Actual external MCP
connections and native Folder setup remain independent. Catalog loading/failure
has explicit recovery without fictional fallback, and the conversation MCP picker
can open the existing real server-setup dialog. No stored contexts are deleted or
reinterpreted. Git and service adapters remain required integration milestones;
this change does not implement them or claim fresh native/signed acceptance.

Ten focused browser checks pass for clean/demo catalogs, loading and Retry,
real local-fixture MCP setup/inspection/attachment, saved-context acknowledgement,
and optional-module recovery. The clean UI matrix injects the clean catalog;
separate real-process persistence tests establish clean/demo world selection.
Forty targeted screenshots cover clean/error entry points and all three demo
browsers across five viewports. Review exposed both a hidden demo notice and a
transformed picker clipping its nested browser: one shared disclosure and a
document-level browser portal repair these, with regression checks watched fail.
The separate responsive sweep passes 135/135 cells with zero violations or skips;
all five screenshot columns were reviewed, and the owner preview remains Ada,
light, with the six-account roster stacked. Repository-specific UI and MCP detail
chrome remain deferred, keeping the existing production bundle budget unchanged.

The current acceptance checkpoint closes the real macOS chooser gap for the
remembered Folder workflow on the unsigned arm64 artifact at `14f20c02`.
[The recorded native walk](acceptance/native-folder-2026-10-05.md) verifies
unchecked Remember and Cancel, temporary-selection expiry, opt-in encrypted
connection persistence, explicit Attach/Refresh, saved-only model input,
missing-source recovery, and Disconnect persisting across native Quit/relaunch.
Exact saved state survives independently of both the source path and device
grant. The temporary connection's full saved-copy journey remains automated
evidence; this manual run does not claim it. Early native-control disagreement
recovered after a clean Quit/relaunch and is recorded without inferring a product
defect. Product source and security policy were unchanged during acceptance.
The separate history-visibility and retention questions remain unanswered;
their answers are not inferred from approval of the six desktop defaults.

The preceding checkpoint extends the same explicit saved-context workflow to images
from existing cloud and mapped-runner sources, preserving Files/Photos placement.
One bounded capture normalizes the first frame to PNG and stores it through the
existing tenant-asset boundary. Original bytes remain transient. Preview, shared
reading and model input use only saved assets; legacy images expose Save snapshot.
Refresh and upload Retry retain one capture. New commits require source and asset
authority, while exact replay recovers a committed receipt after access revocation.
JSON/SQLite persistence, shared visibility, collection, model budgets and monotonic
workspace merging use the same image-reference resolver. Intentional removal of
retry caching, account fencing, reconciliation identity and fresh source authority
failed focused locks before restoration. Review additionally exposed receipts
whose asset was absent, mismatched, orphaned or owned by another tenant. Both
JSON and SQLite now refuse those states at startup; unstamped legacy sessions
retain the runtime-default ownership rule. All ten corruption regressions failed
before repair, and the 16-case persistence suite retains malformed-path refusal
beside the new cross-reference checks.

Nine rendered workflows pass for image capture, saved-only reload/sharing/model
input, held Refresh and identical-payload Retry, malformed/oversized input,
cancellation, account switching and optional-module recovery. The served catalog
and capture code now load only on explicit intake, keeping existing bundle
budgets unchanged. Visual review found a full Files image collapsing into a
thin strip at 844×390; the shared full-preview primitive now preserves its
aspect box and scrolls, with a browser assertion watched fail before repair.
The responsive sweep passed 135/135 cells with zero violations or skips, and
all five viewport screenshot columns were reviewed. The rebuilt unsigned arm64
Electron package passed its complete smoke gate, including imports, source-free
relaunch, remembered Folder access, credentials and backup/restore. Native
dialog results and model responses remain fixtures; signed/Intel acceptance is
not claimed. The complete local verifier remains the final pre-push gate.

The preceding checkpoint `0470d7ae` extends saved context to PDF, DOCX, XLSX and PPTX files
from the existing cloud and mapped-runner sources. It reuses the bounded local
worker importers, keeps raw documents transient, and preserves complete extracted
text plus its format disclosure in a version-2 snapshot. Explicit Refresh owns
one capture across Retry, while failed reads preserve the previous copy. Source
authority is checked for a new commit; a previously committed exact receipt is
recoverable without opening a revoked or absent source. Model input and shared
previews consume only the saved projection. Focused contract, client and backend
tests cover these boundaries. Five rendered workflows pass for all four formats,
saved-copy model input, owner/shared/foreign access, five-viewport recovery,
malformed/oversized/cancelled intake and exact lost-acknowledgement Retry.
Review reproduced extensionless format recognition and empty
ready-document admission and repaired both. Intentional removals of the byte
ceiling, post-extraction account fence and single-capture Retry each failed their
new locks before restoration.

Rendered review reproduced Done clipping under long intake errors and a pane
remount that erased pending Refresh status on an empty transcript. Files,
Photos and Folder now share one bounded scrolling body with a fixed completion
footer. Cache seeding now requires an untouched, unreconciled conversation;
held context operations and recovery survive responsive remounts. Visual review
also found panel recovery covering the prior text on short screens; the shared
panel shell now reserves footer space outside its keyboard-scrollable body,
including while Refresh is disabled. Its drawer body also excludes the shell's
border instead of clipping the final pixel. These repairs have failure-first
locks, including a browser keyboard-scroll check while Refresh is disabled.
The final responsive sweep passed 135/135 cells with no violations or skips;
all five viewport screenshot sets were reviewed. The rebuilt unsigned arm64
Electron package passed native imports, saved-copy relaunch, credentials,
remembered Folder access, update posture and backup/restore smoke journeys.
Native picker results and model responses remain fixtures; signed/Intel and
manual OS-dialog acceptance are not claimed. The complete local verifier is
the final pre-push gate, with no GitHub CI dependency.

This is independent of the pending native Git choices (tracked working-tree
versus HEAD snapshots; bundled versus system Git). Those decisions are not
inferred from the earlier six-default approval. Rich Office fidelity, Git,
permanent deletion, saved-version history and release acceptance
remain required milestones, not replaced by this increment.

The preceding checkpoint `98efdae1` connects the native boundary to the Folder workflow for
approved default 1. The desktop picker offers unchecked Remember, metadata-only
Connect, and separate explicit Attach. Contexts gives each connection one
canonical detail with Disconnect. Conversation copies persist independently;
Refresh captures once per intent and retries those same bytes through a targeted
compare-and-swap endpoint. Preview, shared reading and model input use saved
content, never automatic filesystem reads. Native ownership comes from the
trusted window's session cookie, with renderer identity used only as a matching
precondition. Account transitions fence dialogs, reads and late acknowledgements.
The client preserves old copies through failed capture/save, and ordinary stale
workspace writes cannot rewind a refreshed folder.

Five focused browser workflows pass: canonical main/rail navigation, failed
module recovery, explicit capture and identical-byte Retry, responsive long-name
controls, and owner/shared/foreign access. The separate responsive sweep passed
135/135 cells with no violations or skips. The complete unsigned arm64 packaged
gate passed real native readers, trusted IPC, encrypted remembered grants,
temporary-grant expiry, saved-copy model input after relaunch/disconnect, and the
existing credential, import/export and backup/restore journeys. Native dialog
results and model responses remain test fixtures. The complete local verifier
is the final landing gate; no GitHub CI is used. Bundle budgets remain unchanged;
optional connection controls load on demand with visible, non-mutating recovery.

Review caught and repaired short-landscape completion clipping, delayed request
bodies adopting a detached-and-reattached folder, and shutdown leaving reads
uncancelled. Their regression checks failed before repair. Account-generation
fence removal also fails its lock. Shutdown now aborts active captures and
refuses queued work without erasing remembered grants. Native acceptance exposed
test-only assumptions about bridge shape, hidden chip controls, escaped newlines
and which saved copies survive relaunch; exact identities and structured content
assertions corrected these without weakening product guards or timeout budgets.

The preceding checkpoint `175e2d12` started the native boundary for this default.
The internal local-connection store separates device-private root identity and
access lifetime from portable saved snapshots. Selection defaults to memory-only;
only explicit opt-in enters an OS-encrypted private file. Account bindings are
exact namespace/user pairs, descriptors are path-free, and opening/listing never
reads source content. Explicit capture uses the existing bounded top-level text
policy, pins the selected directory identity, and refuses changed sources.
Disconnect commits before acknowledgement and fences an unsettled capture without
touching saved snapshots or source files. Corrupt or unsafe storage is preserved,
not repaired or replaced. Intentional persistence-filter, owner-gate and late-read
fence removals each fail their regression locks.
The source reader also honors cancellation between reads; disconnect cancels
bounded active captures and independently refuses late output from a reader that
ignores cancellation. Deterministic filesystem-adapter tests exercise replacement,
directory changes and exact publication failures, including post-rename sync
uncertainty. Review caught a test whose retry masked the initial uncertainty wall;
checking read refusal first now fails when that wall is removed. Review also found
that the shared Linux storage check accepted unrecognized backend names. Its
explicit known-secure allowlist now fails closed, with a failure-first regression.

That revision was an internal foundation; the current workflow supplies its
renderer/HTTP integration. Local Git remains a required real-reader milestone,
not the seeded repository picker. Browser remembered-directory support,
recursive selection, actual native dialog interaction and signed/Intel release
acceptance are not claimed by automated browser or unsigned arm64 smoke evidence.
If an account changes after a remembered connection is committed and its cleanup
also fails, the bridge withholds the result but the grant may remain for its
original exact owner; no other account receives it. Explicit Check connections
reconciles uncertain changes. The full Folder/Git workflow remains required.

The preceding checkpoint `4b8852ee` closes the already-open conversation live-observation
gap recorded below. Every authoritative pane read can discover a remotely
started reply, including a restarted orphaned turn. One account-scoped stream
claim per conversation prevents duplicate panes, repeated pushes and late active
snapshots from replaying completed/failed turns automatically. Unsent drafts and
local sends keep their identity; idle-boundary reconciliation catches a next
turn whose start arrived while the prior stream was settling. Shared readers
remain read-only. Reply observation rechecks current access throughout replay
and live delivery and closes on revocation without cancelling owner generation;
an unpersisted handle is not a readable conversation capability.
Controller and route regressions are failure-first; a deliberate dedupe removal
also fails the completed-turn lock. Browser mutations separately disabled ambient
observation and idle-boundary recovery; both failed on the missing live reply.
Restored focused tests pass, including successive owner/reader replies, the
held-prior-stream race, Stop and stale-handle recovery. Responsive captures wait
for the actual rail geometry to settle and inspect the latest reply at all five
viewport sizes. The final local verifier and separate UI sweep remain required
before landing.
The first full gate exposed two old test assumptions: consent resurfacing counted
only mount/push reads, and the manual-Retry walk disabled ambient events but still
allowed the new idle read to prove a lost-response turn completed. The shared
consent lock now includes all three read entries. Manual recovery must keep the
authoritative detail read unavailable through the held failure; a separate
browser walk checks automatic saved-result recovery without another send.
The restored run passed all 3,864 unit tests and every browser shard, but the
production build caught a 280-byte cold-graph overrun. The optional context
browsing dialog now loads only after explicit Browse, while its ready trigger
and attachment workflows remain eager. Loading/failure stay local, cancellable,
and non-mutating; reload warns about unsent text. Its accessibility announcement
was deliberately broken and observed failing both source and browser locks.
The unchanged bundle budgets pass the extracted-dialog build, and the subsequent
complete verifier passed all five lanes and 445 browser tests. Screenshot review
then caught short-landscape recovery controls below the picker's visible edge.
Both browsing entry points now place recovery before the recent-items list;
source-order and full-notice/action geometry checks failed before this repair
and pass afterward. The final revision passed the complete verifier (all five lanes,
445 browser tests) and the separate 135/135-cell UI sweep with no violations or
skips. No retry or timeout budget was relaxed.
No GitHub CI, paid provider or signed/Intel release evidence is implied.

The preceding workbook checkpoint `ba00e035` passed the complete local verifier
(all five lanes and 440 browser tests), 135/135 responsive sweep cells and the
unsigned arm64 native gate. It implements the tabbed-workbook portion of approved
default 4. One artifact contains ordered named worksheets and shares access,
filing, Trash, and one revision-checked Save. Legacy single-sheet content remains
readable and promotes only when a tab-level edit needs the workbook shape.
Import explicitly chooses one visible sheet or all visible sheets, with complete
validation before adoption; XLSX export retains all saved tabs and names.
Limits remain explicit: 20 tabs, 32 columns and 200 rows per tab, 6,400 cells and
20,000 characters across the workbook. Formula execution and rich Office fidelity
remain separate required work. Current revision counters do not retain prior
bodies; browsable/restorable saved versions are not claimed in this checkpoint.
The responsive sweep completed 135/135 cells with no violations or skips.
Review caught stale import-scope labels on a new candidate and an XLSX escape
edge that changed literal tab names. Candidate-scoped choices and one-pass name
encoding/decoding now have regression locks. Structured previews load on demand
without raising the startup budget, with explicit loading/failure/reload states.
Focused browser acceptance covers owner editing/reading, shared reading, foreign
denial, all-visible import, held-save recovery and lazy-preview failure, including
all five viewport sizes. The complete unsigned arm64 packaged gate passes native
workbook import and exact tab persistence after full relaunch. Review corrected
test-only single-sheet selectors, an active-preview mismatch and the import
viewport helper without relaxing retries or timeouts. The complete local
verifier remains the mandatory final landing gate; no GitHub CI is used.
Final review also removed an unrelated blank-header failure from the aggregate
cell-limit fixture: the well-formed over-limit workbook now fails specifically
when that limit is enforced, and omitting the guard was watched fail the lock.
The full gate exposed a source-scan race with Playwright trace cleanup. Its
identity scanner now prunes generated directories before reading them, and an
observed failing regression fixture verifies that authored nested source remains
covered. Orphaned isolated test servers from the interrupted run were stopped;
the live development preview was preserved. A fresh complete gate is required.
That run passed static checks and three browser shards; the fourth exposed one
PPTX test's broad status locator when the new deferred preview announced loading.
The test now names its import-review status explicitly; the final full run must
cover this fix too.

The preceding checkpoint implements the native workflow for approved default 5.
Signed candidates now require a canonical owner-selected update base URL embedded
before signing, checked again in the extracted app, and recorded in schema-v3
candidate receipts. Finalization refuses a different destination; the paired
completion manifest remains schema-v2. No real host or credentials are invented.
The owner-approved public HTTPS URL is still needed before release builds.

Runtime checks are metadata-only, bounded, credential-free and exact-architecture.
They run after 30 seconds and every six hours. The native app menu exposes manual
checks and the current download/install action without granting renderer IPC.
Download and Install and Restart have distinct, default-Later consent. A private
ZIP is checked against the feed's exact size and SHA-256; only install consent
allows a safety backup, strict backend shutdown and a short-lived local feed
serving those verified bytes to Squirrel. Native signature validation stays with
Squirrel; no real signed update installation is claimed. Development packages
remain unconfigured and report that honestly from the menu.

Review reproduced manual/background-check interaction and relaunch-cleanup gaps.
Manual intent now joins in-flight checks, and quit/restore/recovery drain aborted
downloads before exit. Repeated disposal coalesces, later downloads remain inert,
and failed native staging restarts through the established safety-copy boundary.
Intentional consent, shutdown, metadata, size, signed-destination and cleanup
mutations fail their regression tests. All 181 desktop tests pass. The complete
unsigned arm64 packaged gate passes real native menu/activation and unconfigured
notice checks across relaunch, profile admission, OS-backed credentials, imports,
exports, schema isolation and exact backup/restore. Its first run caught a
test-only unsupported dynamic import in Electron's evaluation context; the
helper now reads the actual packaged plist independently and the complete rerun
passes. No product guard or timeout was relaxed. Visual OS-menu/dialog review
was pending at that checkpoint; the actual menu and unconfigured notice now have
[native evidence](acceptance/native-git-review-2026-10-06.md), while signed
download/install consent dialogs still need acceptance. Signed two-version installation/relaunch,
hosted channel publication and native Intel acceptance remain distinct release
gates. The final complete local verifier remains mandatory before landing.

The preceding checkpoint adds the release-feed prerequisite for approved default 5
while the permanent-deletion cascade decision awaits the owner. Finalization
generates deterministic, architecture-specific Squirrel.Mac update feeds from
the two already-verified signed ZIP candidates. A required operator-selected
HTTPS base URL supplies archive locations; no real hosting destination is
invented. Stable-version, URL and exact archive metadata validation happen
before publication. Feeds join the existing immutable publication transaction;
the schema-v2 paired manifest still lands last, and partial output rolls back.
Review found and reproduced mutable-source and partial-copy publication races.
Finalization now validates private candidate snapshots and publishes those exact
bytes. Individual outputs become visible only after complete private copies,
through an exclusive atomic link; a failed copy cannot expose a partial manifest.
Private candidate-snapshot cleanup failures are reported with the temporary path
and inspect-before-retry guidance; a completed release is preserved, and any
earlier validation/publication failure remains available in the aggregate error.
That checkpoint produced release artifacts, not runtime update behavior. The
current checkpoint above adds checks, consent and shutdown coordination;
configured hosting and real signed two-version update acceptance remain required.
Electron's native checker must not run unattended: it stages downloads that may
install on next launch, which would bypass the approved consent policy.
Failure-first locks reproduced omitted feeds, changed candidate bytes, partial
publication and silent snapshot cleanup, then passed after repair. All 136 desktop
unit tests and the complete unsigned arm64 packaged acceptance pass; direct ASAR inspection also confirms
the release generator/publisher do not ship. The complete local verifier passed
all five lanes and 432 browser tests. Final review aligned the older release
ledger with the new eight-file set. A subsequent full run hit an intermittent
MCP proposal timeout; the unchanged trace-enabled full gate and twelve focused
traced repetitions passed. That failure is not claimed repaired; see the open
verification follow-up below. The final revision remains subject to the same
full local gate. No signed update installation or hosted publication is claimed.

The preceding checkpoint integrates the recoverable half of approved default 3.
Trash is a permanent nested collection inside Artifacts, mirrored in the rail;
the canonical artifact page owns confirmed Move to Trash and Restore. HTTP and
MCP expose the same owner-only lifecycle contract. Account-scoped reviewed intent
remains reachable but inoperable across uncertain acknowledgement and navigation.
Retry keeps the exact revision and key, never rebases an old Trash over a later
restore; failed truth reads retain Dismiss recovery. Reload reads durable server
state rather than replaying a browser-stored intent. Retained artifacts are absent
from active content, project/model references, exports and nested social doors.
Nested-only discussion readers receive a private access hint without disclosure
of their inaccessible root artifact. Canonical contents, filing and current grants
survive JSON/SQLite restart; restore never recreates revoked access. Review also
caught and fixed Ada's seed-project filing mismatch and clipped long confirmation
names through their canonical ownership and shared wrapping rules. Browser locks
cover the owner/reader/foreign workflow, lost acknowledgement, a later restore
cycle, and five-viewport recovery/confirmation geometry and accessibility.
The separately confirmed permanent-delete path, including non-resurrecting
retirement receipts, remains the next required slice of default 3. There is no
automatic purge or permanent deletion in this checkpoint. Complete local
verification and the separate UI sweep remain landing gates; no GitHub CI is used.

The preceding checkpoint implements approved default 6: unsafe POSIX modes and
macOS ACL grants refuse startup without repair. Admission is synchronous before
the instance lock and ready-driven product startup. The bundled read-only helper
checks the already-open no-follow directory, distinguishes absent ACLs from failed
inspection, accepts owner-only/deny-only entries and refuses other allow entries,
including inherited and inherit-only grants. Errors offer manual repair guidance,
not database restore. Build hooks compile the exact target architecture and keep
native build/test inputs outside the shipped ASAR. Unit and real temporary-ACL
tests pass; deliberately bypassing ACL inspection, delaying admission with an
await, and selecting the wrong helper architecture each failed their locks.
Review corrected platform-specific repair guidance. Packaged admission acceptance
passes missing-leaf startup, mode/ACL refusal with exact profile preservation,
and successful relaunch after explicit repair of only its disposable fixtures.
An isolated ASAR mutant with ACL inspection bypassed reached backend readiness
instead of refusing and failed the native gate; the artifact was then restored.
The complete packaged suite also passes OS-backed storage, attachments, artifact
imports/exports, MCP and managed restore. Each landing remains gated by the full
local verifier, without GitHub CI. Actual native-dialog visual review
was attempted but the host was locked; it remains unverified, and only the owned
temporary test process was stopped. This is a profile-boundary check, not a descendant
audit or defense against a same-user/admin attacker; trusted parents remain
required. No user's profile has been used as a fixture or repaired.

The preceding checkpoint `fb0e10ea` integrates saved served-folder snapshots end to end:
explicit intake, independent identity even for empty folders, derived read-only
previews, model input, and owner-only Refresh. A folder owns one closed snapshot;
displayed artifacts never duplicate its saved bodies. Refresh pins the reviewed
copy and request receipt, rechecks current ownership, binding and runner grants
after capture, and preserves unrelated workspace changes. Stale ordinary writes
cannot rewind retained copies. Shared readers see saved text without source
reads or mutation controls. Legacy folders require an explicit Save snapshot;
failure retains the copy through the existing Retry / Use saved state workflow.
JSON and SQLite fresh-process locks cover source-absent reopen and replay plus
malformed snapshot refusal. Empty-folder, local-import, draft materialization,
cross-source identity and targeted reconciliation locks cover integration seams.
Adversarial review reproduced duplicate legacy folder identities across workspace
containers. The shared validator now rejects both legacy/legacy and mixed
legacy/explicit ambiguity at intake and JSON/SQLite startup, with observed failing
locks at all three boundaries; multiple files inside one folder remain valid.
The startup budget remains unchanged: conversation panes now seed only from
exact account-scoped API cache, never bundled demo transcripts. The old static
fallback was caught by a failure-first lock while diagnosing bundle growth.
The initial five-viewport sweep covered 135/135 cells with no mechanical
violations or skips. Visual review found eight truncated identity headings that
lacked full-value disclosure; one shared helper now supplies it without changing
layout or rename labels. Native review also corrected the smoke's old file-count
expectation to the new independent folder count while retaining exact file/model
assertions. Final adversarial review then reproduced a committed Refresh whose
lost response left Retry rejecting its own already-synced receipt. Persisted
retries now admit that exact request ID while drafts and unrelated newer copies
remain fenced; the failure-first browser lock proves identical request replay
and the unchanged saved snapshot, including its capture time. The final local
verifier passed all five lanes and 428 browser tests, the final UI sweep passed
135/135 cells, and packaged Electron smoke passed. No GitHub CI was used.

The preceding checkpoint added the internal served-folder capture foundation:
streamed 500-entry admission, the existing local whole-text budgets and omission
policy, independently enforced list/read grants, and refusal after folder or
represented-authority changes during capture. The limits apply before filtering
or body reads, so hidden/unlisted entries cannot bypass the enumeration ceiling.
Failure-first tests cover the missing capability; deliberate cap, directory
version and runner-filter regressions each failed before restoration. Final
review then reproduced grant narrowing between the reader's final check and
its facade's await continuation; both boundaries now share the exact-output
authority predicate, with a failure-first microtask regression. This is
not yet a user-facing folder snapshot feature: intake, durable identity, model
projection, targeted Refresh and rendered recovery are the next integration
checkpoint. No new public route, UI behavior or filesystem permission is added.
The complete local verifier remains the landing gate; no GitHub CI is used.

The preceding checkpoint implements the approved saved-copy policy for individual
served cloud/runner text files. Explicit selection captures bounded whole text;
previews, reopened conversations and both model transports use that persisted
copy without new source reads. Owner-only Refresh replaces only its addressed
copy, pins the reviewed snapshot and keeps one durable request identity through
response loss or restart. Failed source reads preserve saved input; a read-only
recovery action reconciles current truth before releasing the send hold. Live
sync may expose a committed copy even when its HTTP acknowledgement is lost.
Ordinary stale workspace updates cannot rewind an existing copy. The strict
reader, source/path-bound response checks and former live-preview read each
have observed failing regression locks; fresh-process JSON and SQLite tests
prove saved-copy restoration and receipt replay without source reads.

The UI review exposed preview takeovers interrupting multi-add intake, wide
split changes remounting the picker, and portaled options escaping both busy
state and accessible button semantics. Shared presentation/overflow fixes retain
Done and cancellation without delaying saved attachment authority. The isolated
sweep passed 135/135 cells with no skips or violations; all 137 current sweep
captures and 42 focused saved-copy captures were inspected at original size.
Final code review also reproduced a delayed ambient Session read visibly
rewinding an acknowledged Refresh. Pane reads now carry session/context/order
receipts; stale responses cannot overwrite a newer copy or run panel/reattach
side effects, while transcript-only streaming and pagination retain their
separate lifecycle. A second failure-first browser walk caught a superseding
push read losing the startup reattach callback. Mount and push now share one
effect-scoped, one-shot obligation, retired by cleanup or an epoch change; this
does not add automatic discovery of later shared turns. All 26 focused browser
journeys pass, including saved copies, startup recovery, account switching,
panel preferences and Stop. The complete unsigned arm64 Electron gate also
passes: OS-backed credential recovery, native intake and source-absent relaunch,
MCP credentials, packaged schema isolation and exact backup/restore. Picker
smoke walks now await saved text/image acknowledgement before choosing Done;
their exact body, image-byte, model-input and relaunch assertions remain intact.
Complete local verification and packaged Electron acceptance remain mandatory
landing gates; no GitHub check substitutes for either. These are not signed,
notarized or Intel release receipts.

The saved-file and folder slices implement approved policy 2 for served text;
unsupported formats remain explicit omissions. They do not complete all six defaults:
remembered local/Git connections, workbook tabs, the complete Trash workflow,
and update consent remain required milestones. Profile refusal is implemented
as described above, with native-dialog visual review still outstanding.

The preceding checkpoint repairs the conversation Stop workflow and its authority
wall. Failed cancellation previously disappeared into an empty catch. Shared
per-conversation state now distinguishes pending, acknowledged and failed Stop
requests, bounds each attempt to 30 seconds, and permits only deliberate
same-turn retry. Stream completion remains authoritative; account disposal and
turn replacement abort outstanding requests and fence late responses. The
failure-first controller suite exposed the missing lifecycle before repair.
The related route audit reproduced view/comment/propose grantees both appending
prompts and cancelling the owner's live turn. Send and cancel now share an
owner check before request parsing or replay; reading and stream attachment
remain grant-aware. The UI derives control from the server's ownership face,
keeps shared readers read-only, and offers accessible Stop recovery to owners.
Complete verification, five-viewport recovery and owner/reader/foreign review
remain landing gates. No new collaboration permission policy is introduced.
The corrected browser lock was watched fail when the Stop-state prop was
removed, then restored. Review also identified a separate existing freshness
gap: an already-open shared reader reconciles completed turns, but the live
attachment callback currently runs only on opening the conversation. The
permission regression verifies opening/reloading onto an active turn; automatic
discovery of a newly started turn remains follow-up work, not claimed here.
The production build caught the new cold graph at 800,686 bytes, above its
unchanged 800,000-byte cap. The existing low-frequency approval display is now
deferred with a local announced loading/failure boundary, preserving the
conversation and warning about unsent text before explicit Reload. Display
mounting and failure never invoke approval. Its dedicated browser checks cover
loading and failure at all five viewports, plus loaded Deny/Grant-access focus
and explicit reload recovery; budget and consent policy are unchanged.
The focused eight browser journeys passed; intentional removal of the loading
status and reload warning then failed both approval tests before exact source
restoration. The final isolated sweep covered 135/135 cells with no skips or
violations. Packaged unsigned Electron smoke passed. In the signed-in preview,
an explicit Stop preserved its partial through reload; Ada remains active with
all six demo accounts stacked. Complete repository verification remains the
final landing gate.

The preceding checkpoint `c7dbe4f2` addresses a demonstrated core authoring defect: after a
failed save, navigating away from a Document, Sheet or Slides page erased its
visible draft while the shell still promised recovery. All three failure-first
browser walks reproduced the missing editor. One account-scoped memory store now
owns body drafts across navigation and duplicate panes, including ordinary
unsaved edits. Save acknowledgement and explicit Cancel clear the draft; Dismiss
keeps it editable. Account changes clear it and fence late outcomes. Existing
revision checks and exact-key Retry remain unchanged, with no browser-storage or
server draft persistence. Structural Document editing still awaits the separate
block-identity/comment-anchor decision; this repair does not select that policy.
Review also reproduced a reconciled Document losing its edited block. Its exact
draft now remains available to copy or Cancel with Save disabled; no replacement
block is guessed. A deliberately removed account-disposal hook failed both
source locks before restoration. The signed-in preview retained an unsaved Sheet
note across navigation, then Cancel preserved the saved body; all six accounts
remain stacked with Ada active. Complete verification and the isolated visual
sweep remain this checkpoint's landing gates.
The isolated sweep completed 135/135 cells with no skips or violations, and all
142 screenshots plus 114 focused artifact captures were visually reviewed.
Focused recovery review exposed 3.58:1 dismissal guidance; the new WCAG 2.2 AA
checks failed in Document, Sheet and Slides before both editor surfaces adopted
the shared readable danger-text token. Recovery states are rechecked at all five
viewports after that repair. The preceding `304388de` checkpoint is also green
in GitHub run `37200291313`.

The preceding checkpoint `304388de` fixes a relay deadline defect exposed by Linux CI on
`60d4255c`: a whole-turn-clamped tool timer could expire while wall time still
reported a millisecond remaining, dispatching a sibling call or delivering an
unusable continuation. The shared executor now returns sticky whole-turn expiry
and the relay stops before another offer. Shorter per-tool timeouts remain
recoverable; budgets, retries and authority are unchanged. Deterministic
lagging-clock locks failed against the old code at both boundaries before the
fix. Complete repository and packaged verification remain the landing gates.

That checkpoint also closes actual native-dialog acceptance for the selected
XLSX worksheet workflow on `60d4255c`. The [native workbook record](acceptance/native-workbook-2026-10-04.md)
documents real Open/Save dialogs, cancellation, visible worksheet choice,
missing-cache refusal, header mapping, explicit adoption, canonical creation,
editing and byte-identical export. After the source path was removed by moving
only the generated input aside, a full app relaunch retained exact identity,
literal body, revision and export. This uses a clean disposable profile and an
unsigned arm64 package; generated XLSX input does not prove Excel-application
or corpus compatibility, rich Office fidelity, signing, notarization or Intel.
The native acceptance itself changed no implementation or permission policy.

The preceding checkpoint `60d4255c` extends the existing Sheet review/adopt/Create workflow
to XLSX. A separate bounded worker result preserves visible worksheet identity
and sparse literal cells. Users choose one worksheet and header mapping; its
used rectangle is checked before allocation, with no clipping. Missing formula
caches refuse adoption; cached values are disclosed as potentially stale. Styles,
merges, media, hidden content and calculation are not imported. The ordinary
artifact body, creation, editing, permissions and export remain authoritative.
Focused browser acceptance passed all 11 Sheet/import-recovery/XLSX-attachment
tests; the isolated UI sweep covered 135/135 cells without skips or violations.
Packaged unsigned arm64 acceptance imported a selected worksheet through real
native bytes and IPC, then preserved the exact saved body after source removal
and a full relaunch. The live preview was reviewed with all six demo accounts
stacked and left on Ada's saved Sheet. Failure-first locks caught missing-cache
adoption, name collisions and accidental use of the flattened attachment mode.
A final Unicode probe caught rejection of leading BOM cell text; failure-first
contract/package locks now preserve that literal character without accepting
lossy lone surrogates, and the native fixture includes it in the exact body.
The complete repository verifier remains the landing gate; actual Excel corpus,
signed/notarized binaries and Intel acceptance are not claimed by these fixtures.

The preceding checkpoint `3d1d5ac5` closes the demonstrated desktop POSIX-mode gap: startup
admits and, if needed, tightens the owned profile directory to 0700 before
application credentials or SQLite open. Repair operates on a no-follow directory
descriptor and preserves existing work; wrong owners, symlinks, broad paths and
aliases, unsuccessful repair and changed identity stop startup without offering
an unrelated database restore. Failure-first locks cover these boundaries, and
ordinary packaged startup/relaunch checks use only a generated 0755 profile and
an exact preservation sentinel. Those post-readiness checks also passed the prior
package because later MCP reconciliation already tightens mode; they do not prove
the early boundary. The separate source-order lock failed an unawaited guard, and
filesystem locks failed unsafe permission/identity mutations.
This is not complete local filesystem isolation:
extended macOS ACLs are neither audited nor removed, parent directories must be
trusted, Windows retains OS-managed ACL policy, and earlier Chromium/session or
instance-lock writes are outside this startup-order guarantee. ACL-managed macOS
profiles remain a separate release-review gap; no administrator/same-user defense
is claimed. A subsequent disposable-directory probe confirmed that an explicit
macOS `everyone` list/search ACL remains after the current guard admits mode
0700. The fixture stayed inside its own private temporary parent; no other
account access or normal profile was tested. The owner has since approved the
refuse-and-preserve policy in default 6 above; its implementation supersedes this
historical mode-repair behavior at the current checkpoint. The earlier mode-only
pass is not ACL evidence or acceptance of the new policy.

The preceding checkpoint `4802b9fa` fixes a defect observed while reviewing native recovery:
editing a document changed its body and Edited time, but left its index preview
showing the creation text. Automatic previews now follow the exact saved body
for Documents, Sheets and Slides, including granted readers. Explicit summaries
remain independent; legacy direct-create identities upgrade because their
creation contract never accepted a synopsis, while ambiguous older consent
saves retain theirs. The preview oracle is shared with authoring and does not
change edit/rename ordering, grants or save identity.

The actual native recovery walk created a disposable profile, saved a baseline
document and backup, added distinguishable later work, and proved picker
cancellation preserved both documents, the process and the backup list. Actual
restore/relaunch remains awaiting owner approval; no normal workspace was used
or restored. The test app exited normally and its generated profile is retained.
The review also found the permissive user-data directory addressed by the current
mode guard; effective access additionally depends on parent permissions and ACLs.

The preceding checkpoint `1a2ce9e2` closes the missing packaged backup-restore acceptance
path. Rendered controls reach the real trusted IPC, pre-restore safety copy,
backend shutdown, ASAR worker and SQLite replacement. Exact before/after
Documents, Sheets, Slides and conversations distinguish restoration from a
restart that does nothing; restoring the safety copy recovers the newer work.
Cancellation and malformed-snapshot refusal preserve current data. The existing
pre-backup provider vault, device auth root and personal token remain intact.
Only generated throwaway profiles are used. Dialog answers and relaunch spawning
are controlled by the test, so this does not claim actual OS-dialog interaction,
automatic OS relaunch, rotated/deleted credential recovery, or signed/Intel
release acceptance. The ordinary executable smoke retains its separate real
OS-storage gate. An isolated package whose restore worker acknowledged success
without writing data was rejected by the new exact-workspace assertion.

The fresh packaged gate also exposed a separate source-picker defect: at phone
width, the horizontal source scrollport intercepted clicks on its own visible
buttons. Retained screenshot/geometry evidence reproduced the failure. Files,
Photos and Folder now share wrapping, width-bounded source choices; long-name
browser coverage failed on the old overflow before the layout correction.
The complete packaged desktop gate passes, including the native folder path and
all new restore scenarios. The separate UI sweep covers 135/135 cells with no
skips or violations. The Files picker at short landscape uses its existing
vertical scroll; an ordinary Done click remains reachable and is locked in the
new five-viewport walk alongside WCAG 2.2 AA checks.

The preceding checkpoint `b46fddec` removes fictional context inventory exposed by the clean
native review. The shared estimate now sums only supplied categories and keeps
the snapshot's own deferred rows through live-message/model overlays. Base-tool
estimates follow the Agent allowlist and transport capability; the popover names
the four-character approximation, omitted runtime inputs and local-only limits.
This is honest partial accounting, not a full request tokenizer or provider bill.
Failure-first contract/store and five-viewport browser locks cover the defect.
Its final complete verifier passed all five lanes and 384 browser tests in
281.7 seconds; the separate UI review passed 135/135 cells without skips or
violations. The reviewed checkpoint is published on main.

The preceding checkpoint `af66da4e` completes the unfinished native CSV/TSV Sheet workflow
checks. Actual OS selection, explicit header mapping/adoption, canonical save,
editing and native XLSX download are now backed by exact body/export comparisons.
Both saved Sheets survive a full app relaunch with the generated source paths
absent; IDs, literal values, notes and revision-one bodies remain unchanged.
The [native Sheet acceptance record](acceptance/native-sheet-2026-10-04.md)
names the two runtime revisions and download hashes. This is unsigned arm64
evidence, not signed/notarized, Intel, Excel-application or rich-workbook acceptance.
The read-only workflow audit found no concrete code defect; no new product policy
was inferred. The complete verifier and final diff review remain the push gate.

The preceding checkpoint `d3753db2` fixes a demonstrated clean-install content leak found
during actual native CSV artifact acceptance: an empty registry still exposed
the global demo body library through the artifact-content API. Bodies now require
current artifact/session read authority; compatibility names must be unambiguous
and cannot replace exact IDs. Renames and revocation withdraw aliases too.
Failure-first store/clean-boot and authenticated HTTP/MCP tests reproduce the
defect. The rebuilt unsigned arm64 app returns an empty library on a fresh SQLite
profile and only the exact saved Sheet plus its unique alias after relaunch of
the existing CSV review profile. The [scoped acceptance record](acceptance/artifact-content-2026-10-04.md)
records the package and limitations. Its initially unfinished TSV/source-absent
cells are completed by the native follow-up above. The complete five-lane
verifier passed all 383 browser tests in 261.7 seconds before publication;
no new artifact identity or removal policy was inferred.

The preceding checkpoint `057d5fe4` completes the four previously unverified native context
removal cases. The [2026-10-04 acceptance record](acceptance/native-context-2026-10-04.md)
uses a fresh unsigned arm64 package of `2abc976d`, actual macOS Files/Photos/Folder
dialogs, and a credential-free local model fixture. XLSX, PPTX, PNG and folder
imports and previews passed; each independent detach preserved exact siblings
and prior messages. The final native-composer request supplied no attachment
document or image blocks. This does not repeat the prior source-absent relaunch
matrix or constitute signed/notarized, Intel or paid-provider acceptance.

The preceding checkpoint `2abc976d` is published on main and closes a demonstrated backend gap in served-file intake:
directory enumeration failure was still acknowledged as an empty catalog or
workspace, despite the picker's recovery states. Missing/replaced roots and
failed root/folder scans now remain unavailable through cloud and mapped-runner
reads; unknown child counts are never fabricated as zero. Genuinely empty
directories still succeed. Failure-first reader tests reproduced the false-empty
responses; route and journal tests cover refusal, recovery and no successful
effect. Restoring the empty fallback, zero-count recount fallback, and missing
runner refusal each made the new route lock fail before restoration. The
complete verifier and diff review gate this checkpoint. No new
model input, source lifetime or native authority is inferred.
The first complete run passed all five lanes and 383 browser tests. Final review
then reproduced root replacement during child inspection publishing a partial
catalog; a final anchor check now refuses it, with a failure-first regression.
The final immutable-tree verifier passed all five lanes and 383 browser tests
in 300.9 seconds; adversarial diff review found no remaining scoped findings.

The preceding five checkpoints are published through `fc42d8f` on main; the
owner's renewed push instruction resolved the private-repository upload gate.
The final picker verifier passed all five lanes and 383 browser tests, and the
separate responsive review passed 135/135 cells without violations or skips.
GitHub run `35867243830` did not start its jobs because of account billing or
spending-limit annotations. The newer run `37185242103` has started all jobs and
passed Checks; its browser lanes were still executing at 07:35 UTC on October 4.
The historical billing failure is not the current run's observed blocker; no
full CI success is claimed while those lanes remain pending. Remote-source
input now follows approved default 2 above; the approval is not implementation
evidence.

The picker checkpoint repaired served-file intake recovery before extending
remote-source model input. Failed source/catalog reads must not appear empty or
silently select the local disk, and a failed folder read must not create an empty
workspace. One shared read-state/retry face, bounded reads and source/account/
picker lifetime fences cover the three filesystem pickers. Approved default 2
now selects the remote-input policy; no model authority was introduced by this
recovery work. Seven focused browser walks cover retry,
404, stale cached rows, served close/source cancellation and local leave-return
cancellation. The restored false-empty behavior was watched fail in both the
pure policy and rendered 404 checks; removing a read deadline also failed.
Browser acceptance and the full verifier remain required before committing.
The first full run passed all four browser lanes but caught the new spec's
nested test declarations falling outside the verifier's top-level manifest.
The tests now follow the repository's existing declaration convention; no
verifier check, assertion or coverage expectation was relaxed.
The next full run passed all 3,527 node tests and all browser lanes but exceeded
the unchanged 800 KB startup graph budget by 961 bytes. Files and Photos now
share one intake component, and the local drop zone joins the existing lazy
admission boundary before file selection. Review also caught cached success on
the first render before passive revalidation: a failure-first render lock and
held-response browser walk now require loading from that first render onward.
The final focused browser walk passed all ten recovery/loading tests. The
separate responsive sweep covers 135/135 cells with zero violations or skips;
the static/build lane is green after the image-boundary lock followed its
extracted chooser. The final immutable-tree verifier subsequently passed,
without changing the startup budget or adding retries.

The preceding checkpoint `36a50ef` passed the complete verifier in 249.2 seconds,
including all 375 browser tests, and is published on main. It closes a pre-existing runner grant bypass found during
the filesystem review: revoking both advertised filesystem capabilities still
left known catalog/folder/text/content URLs returning 200. Source routes and
mediated invokes now share one fixed logical/physical binding and one cached
reader; current list/read grants govern their respective operations. Narrowing
a grant filters the same tree, not a newly re-rooted tree; browse projections
omit unrelated entries and counts, retaining only the navigation branch needed
to reach an explicit list grant. This is not a new enrollment, tenant storage,
native filesystem grant, or live-folder/model-input feature.
The new route lock first failed with four unauthorized 200 responses. Replacing
the actual grant predicate, removing folder filtering, flattening the fixed
nested path and recreating a root reader per call each failed the new locks
before restoration. Denial tests keep a readable live fixture until those
assertions finish; root-replacement tests run afterward so missing data cannot
make permission assertions pass vacuously.

The preceding checkpoint `47c05ee` passed the complete verifier in 257.8 seconds,
including all 375 browser tests, and is published on main. Its earlier publishing
block was resolved by the owner's renewed push instruction.
That checkpoint repaired the shared served-filesystem boundary before
extending remote-source input. Failure-first tests reproduced outside bytes via
a descendant symlink, an outside folder listing and a catalog crash on a broken
link. Readers now pin their configured canonical root, accept exact visible
relative handles, omit descendant links/special files and use identity/version-
checked bounded descriptors (256 KiB text; 32 MiB raw). Cloud and runner route
tests exercise real isolated roots and preserve unavailable/404 responses.
A mapped runner's missing read also reproduced a false mock success; mapped
read/list refusals now fail before a successful effect is journaled.
This does not introduce remote model input, new picker authority, hosted tenant
storage or OS-level isolation from a hostile local process. Directory-cardinality
and slow-filesystem bounds remain work for the production storage boundary.
The final revision must pass the complete verifier and adversarial diff review.
Removing the raw-byte ceiling, descriptor cleanup and post-read integrity check
each failed the new locks before restoration. Removing the mapped subfolder
refusal likewise failed its route test. The byte-response integration check also
caught a Buffer-to-Uint8Array compatibility regression in router re-entry; the
bounded reader now preserves the existing Buffer runtime representation.
The first complete run passed all four browser lanes but found four older
invoke/journal tests that expected successful mapped reads of nonexistent files.
They now use actual committed runner fixture files, preserving success, cursor,
permission and coordination assertions; no refusal was changed back to success.

The preceding SVG checkpoint is published as `2be75d3`; its final full
verifier passed all 375 browser tests, unsigned arm64 packaged smoke passed and
the separately run rendered review covered all 135 cells without violations.
Both it and `f398685` were subsequently published with explicit owner approval.

That checkpoint added self-contained static SVG local image input through
the existing Photos workflow. XML is admitted in the shared isolated parser
worker under 8 MiB/8,000 px/32 megapixel and 10,000-node/64-depth/50,000-expanded-use
bounds, then decoded as a detached image and normalized under the existing
15-second total deadline and 2,000 px/3 MiB PNG limits. Scripts, animation,
external resources, malformed geometry and recursive reuse fail visibly;
static embedded PNG/JPEG share a 32-megapixel aggregate budget, and local
gradients/clipping/styles remain supported.
No original SVG or inline markup is retained and no native authority/API is added.
Malformed percentage geometry was watched fail before correction. Removing the
actual closed-result validation, worker termination and object-URL cleanup each
failed the new locks before restoration. Acceptance requires the frozen-tree
browser, full verifier, responsive and unsigned arm64 runs, including real colored
SVG pixels, durable/model references, rejection without external requests, and
native relaunch after the source files are deleted. Manual OS-dialog, paid-provider,
signed/notarized and Intel release evidence remain distinct external gates.
The first native SVG run caught a stale three-image readiness assertion after
the batch grew to four; the harness now derives readiness and expected model
copy from its fixture list, without weakening reference or byte checks.
The first full verifier caught two source-lock false positives: active-SVG test
data used a dialog function name, and an MCP identity regex consumed unrelated
later SVG copy. The fixture now uses an inert marker and the MCP lock names the
actual external/legacy mapping branches; mutating the real external ID mapping
was watched fail before restoration. The embedded-pixel aggregate guard likewise
has a failure-first structural-header test, distinct from real codec acceptance.
The provider-form viewport walk also sampled before the existing resize/observer
geometry update; it now waits for the same 7 px panel/footer bounds before
measuring, with unchanged test budgets and no retries.

The preceding BMP/ICO checkpoint is published as `f398685`. Publishing
was initially rejected by the automated permission gate; the owner's renewed
instruction resolved that upload gate. The existing remote
CSV/TSV CI failure remains the billing gate described below, not SVG acceptance.

That checkpoint added bounded BMP/ICO local image attachments through
the existing browser and Electron picker, preview, durable upload and model
input workflow. It recognizes CORE RGB depths 1/4/8/24, INFO/V2/V3/V4/V5 RGB
depths 1/4/8/16/24/32 and 16/32-bit BITFIELDS, plus ICO files with disjoint PNG/DIB
entries and deterministic largest-area/depth/file-order selection. Inputs remain
transient and durable image snapshots remain PNG/JPEG/GIF/WebP after the
existing ≤2,000 px/≤3 MiB normalization. The 8 MiB raw, 24 MiB selection,
8,000 px, 32 megapixel and 15-second abort/decode bounds are unchanged. Focused
tests cover malformed/truncated, mask/palette, directory, overlap, cursor and
selection cases. The browser codec matrix decodes 86 real BMP/ICO cases and
checks normalized dimensions and colored pixels. Reversing the actual ICO
area, depth and directory-order choices was watched fail before restoration,
as was reading the V5 linked-profile marker from the wrong header field.
Microsoft's header confirms the existing color-space field and numeric marker;
the implementation needed no change for that review concern. The complete
five-lane verifier passed all 374 browser tests, the complete Node suite,
type checking and the production build under unchanged budgets. The frozen-tree
responsive sweep passed 135/135 cells with zero violations or skips. All 137
fresh sweep originals and 25 focused PNG/BMP/ICO, shared-view and error originals
were individually reviewed at full resolution with no remaining findings.
Unsigned arm64 packaging and every executable smoke phase passed. A single
native PNG/BMP/ICO batch proves real selected-file reads and IPC, normalization,
exact authorized model bytes, full relaunch after deleting all source files,
exact asset-reference preservation, restored previews and independent detach.
Native results still simulate the OS dialog; manual dialog, signing/notarization,
Intel and paid-provider acceptance remain separate gates. The new harness was
corrected to pass dimensions into its browser callback and use the actual
grouped Photos menu as the batch shrinks; no product behavior or budgets changed.
The shared light desktop preview has all six demo accounts stacked, with Ada
active on the local Photos intake surface.
No Image-artifact retention or original-image persistence decision is made.
Workbook identity is now resolved by approved default 4 above. Image original
retention and document-edit CAS remain pending owner decisions.

The preceding checkpoint adds CSV/TSV-to-Sheet import through the existing bounded
local reader and shared review/adoption ceremony. Quoting and literal values are
preserved; first-row column names versus generated headers are an explicit review
choice. Malformed, ragged or oversized input is rejected without partial adoption.
Only normal keyed Create saves; canonical correction, sharing and XLSX export
remain the same workflow. This is progress on file-based spreadsheet authoring,
not a replacement for required XLSX workbook tabs, formulas or rich Office fidelity.
Intentionally breaking doubled-quote handling, the Create-during-review guard,
and real draft adoption each failed their locks before restoration. The final
complete five-lane verifier passed all 373 browser tests, the complete Node
suite, type checking and the production build under unchanged byte budgets.
The frozen-tree responsive sweep passed 135/135 cells with zero violations or
skips. All 137 fresh sweep originals and 40 focused import/replacement/error
and owner/reader/foreign originals were individually reviewed at full resolution
with no remaining findings. Focused review also proves keyboard horizontal scrolling inside the
named sheet preview at 320 px without page or dialog overflow; a partly visible
last column was not a clipping defect. Header-error copy now quotes the actual
checkbox label. The shared preview remains on Artifacts in light desktop mode,
with all six demo accounts stacked and Ada active.

Unsigned arm64 packaging and every executable smoke phase passed. The new
native CSV/TSV checks cover real text reading and IPC, explicit header mapping
and adoption, exact saved identities/bodies, and a full app relaunch after the
source files are deleted. Native picker results are still simulated by this
harness; actual OS-dialog, signing/notarization, Intel and paid-provider
acceptance are not claimed.

The CSV/TSV checkpoint is recorded at `e9f8dc4`. GitHub run `34465411546`
failed before workflow steps because of account-billing annotations; that is an
external gate failure, not a code failure in the checkpoint.

The first complete run exposed two existing test races: a 50 ms credential
test timeout competed with `setImmediate`, and a read-only MCP proxy could
close its page while `route.fetch` was unfinished. Protocol send/start/ack
signals now replace scheduler waits in that credential test. The MCP proxy
unroutes and drains pending handlers before page closure, preserving errors
and always closing the reader. Deliberately removing that drain failed its
new regression test immediately; restoration passed. These repairs changed no
product policy, retries or timeout budgets.

The preceding runtime-admission checkpoint closes a demonstrated New artifact
failure: the form now waits for both the lazy dialog module and the actual
shared creation runtime before mounting fields, so a rejected runtime remains
closeable/reloadable and cannot start a mutation during admission. The new
failure-first browser lock observed the old path fail (opening the form made
zero runtime requests where one was required); the source lock also failed
when the preparation call was removed. Focused type and Node tests passed.
Final acceptance passed the complete five-lane verifier: all 369 browser tests,
the complete Node suite, type checking and the production build under unchanged
byte budgets. The frozen-tree responsive sweep passed 135/135 cells with zero
violations or skips. All 137 fresh sweep originals and 15 focused loading,
failure and recovered-form originals were individually reviewed at full
resolution with no remaining findings. Live keyboard checks confirmed that
short-screen form fields scroll fully above the persistent footer; clipped
offscreen content was not an overlap defect. Unsigned arm64 packaging and every
executable smoke phase passed, including creation, Office downloads, credentials,
relaunch, managed backup, input and MCP schema checks. Native picker results
remain simulated where recorded by the harness; actual OS-dialog, signed/
notarized, Intel and paid-provider acceptance are not claimed.
Workbook organization now follows approved default 4 above; account/workspace
versus device appearance persistence remains an owner decision. No
production-ready claim is made here.

The preceding checkpoint added Download Word beside Markdown for saved Documents
and email artifacts. A fresh exact-ID read snapshots current saved content,
preserves ordered title/headings/prose/lists/code/email text in editable DOCX,
and rechecks visibility after serialization. Both actions share edit and
in-flight holds; missing/foreign/revoked content remains hidden. Markdown stays
the omitted-format default. This does not reproduce imported rich Word layout.

Independent rendering exposed incomplete local ZIP headers: generic archive
readers accepted the files, but LibreOffice could not open DOCX/PPTX. All three
Office exporters now share deterministic stored ZIP finalization with complete
local sizes. A header-descriptor mutation was watched fail, as were bypassing
the DOCX post-serialization access check and losing email-label separator spaces.
The actual generated DOCX renders through bundled LibreOffice; its fontconfig
must be selected explicitly for installed Japanese font fallback. All four
rendered pages were individually inspected for text, wrapping and pagination.
All eight focused browser export checks passed. The final complete five-lane
verifier passed all 368 browser tests, the complete Node suite, type checking
and the production build on Node 26 under unchanged byte budgets. The frozen-tree
responsive sweep passed 135/135 cells with zero violations or skips. All 137
fresh sweep originals, 35 focused Office-export originals and 15 provider-dialog
originals were individually reviewed at full resolution with no remaining
findings. Manual foreign-account denial also passed at all five canonical sizes.
Unsigned arm64 packaging and all executable smoke phases passed, including an
actual Word download whose disk bytes match a fresh authenticated descriptor.
Existing credential, relaunch, backup, input and schema checks remain green.
Picker results are simulated where recorded by the native harness; this is not
actual OS-dialog, signing/notarization, Intel or paid-provider acceptance.
The Word checkpoint at `1ce88ca` passed GitHub run `34453295428`.
The runtime-admission checkpoint at `fa59100` passed GitHub run `34458055885`.

The first complete plan passed all 368 browser tests but caught a source-lock
literal being interpreted as a real suite-relative import; the assertion now
matches the serializer import as syntax. Live UI review found adjacent identical
download glyphs, so both document choices use a captioned shared SectionAction
variant. Ordinary icon-only header verbs keep their existing quiet presentation.
The new visible-label constraint and geometry lock belong to UI-154. Both source
locks and the browser test failed when captions were intentionally hidden.
The next full pass exposed an immediate provider-dialog geometry sample during
a viewport resize. Its helper now waits for the same strict panel/footer bounds
under the existing assertion deadline. Disabling the real resize updates was
watched fail this stabilized lock; no production dialog rule or budget changed.
Five diagnostic repetitions and the final complete verifier passed afterwards.

The preceding checkpoint added structural PowerPoint-to-Slides import. It preserves
real visible slide boundaries rather than interpreting flattened attachment
text, including explicitly numbered empty slides. First nonblank paragraphs
become titles, remaining paragraphs/table rows become bullets, and the complete
outline must fit the existing authoring limits. Read-only review explains the
mapping and omitted fidelity before explicit Use/Replace; normal keyed Create
alone saves. A common import lifetime and review frame now serve Document and
Slides, retaining cancellation, account/format fencing, draft/name preservation,
focus recovery and actual lazy-loader failure recovery without widening native
authority. Rich Word, workbook tabs/formulas and rich presentation fidelity
remain required; workbook artifact identity now follows approved default 4 above.

The first complete gate caught a section-navigation graph of 505,847 bytes,
above its unchanged 500,000-byte limit. Artifact creation is now a separate
on-demand form behind a shared bounded loading/error ceremony, loaded before
draft input exists. The existing resource FormDialog/FormField primitives move
to their own module without changing layout or behavior. A real module refusal
requires explicit reload with unsent-workspace guidance, never an automatic
retry of the browser's rejected URL.
The shared shell has an explicit independent chunk so the lazy form cannot
pull section navigation back in through a shared-module dependency. Physical,
cold, async and worker byte gates remain unchanged. The shell's default Node
was 24; final verification explicitly uses the installed required Node 26.

Focused parser, contract, mapping, UI-host and browser checks have passed.
Intentional dropped-bullets, no-op adoption and no-op Reload mutations failed
their respective pure/browser locks before restoration. Browser checks prove review/adoption, editing, reload, ownership,
sharing/foreign denial and actual PPTX download bytes and XML; the existing
Document import/recovery and PPTX attachment paths also pass. The frozen-tree
responsive sweep passed all 135 cells with zero violations or skips. All 137
fresh originals (excluding five historical captures) and 70 focused import,
review, failure, loading and owner/shared/foreign originals were individually
reviewed at full resolution with no remaining findings. The complete five-lane
verifier passed: all 367 browser tests, the complete Node suite, type checking
and the production build under unchanged byte budgets. Unsigned arm64 packaging
and all executable smoke phases passed
on Node 26, including exact imported slide identity, revision and body surviving
a full relaunch after the source PPTX was removed. Native picker results are
simulated; selected-file reads, IPC, emitted workers, review/adoption, saving and
relaunch are real. This does not claim actual OS-dialog interaction, signing,
notarization or Intel acceptance. The previous Document checkpoint's GitHub run
`34438685229` is confirmed successful.
The Slides checkpoint at `21bbd8a` also passed GitHub run `34446360264`.

Acceptance also exposed stale source-owner checks after the form extraction and
an MCP browser fixture teardown race. The former now read the shared form owner;
all MCP proxy consumers drain their page-owned handlers before closing servers.
A held-acknowledgement browser lock was watched fail when draining was disabled.
The first responsive sweep was rejected because concurrent test/package edits
triggered Vite reloads; the accepted sweep above ran without edits. The first-run
setup fixture now keeps its release-shaped registry projection until the whole
conversation completes, then drains routes in finally. Artifact cancellation
checks use layout-stable scrolling after viewport changes; eight consecutive
five-viewport diagnostic walks passed with unchanged assertions and budgets.

The preceding checkpoint added a reviewed file-to-Document workflow to New artifact.
One text, PDF or DOCX file is read through the existing bounded UI-host/native
reader; only explicit adoption changes the draft, and only normal keyed creation
saves it. Text-only conversion discloses omitted formatting, images, layout and
OCR; PDF/Word extraction details remain visible during review. Unsupported or
multiple selections are rejected before parsing, oversized source is rejected
before the authoring clamp, and cancellation, format change, closure and account
switch fence late work. A typed name is never replaced by a filename suggestion.
That checkpoint did not include structured Office import; the current Slides
mapping above extends it without claiming rich Word or multi-sheet workbooks.

The full five-lane verifier passed, including 362 browser tests, the complete
Node suite, type checking and production build under unchanged startup budgets.
The responsive sweep covered 135/135 cells with zero violations or skips; all
137 fresh originals were individually reviewed at full resolution. Another 35
originals cover import review, error, loading failure, in-flight reads and the
owner/shared/foreign saved-document faces at every canonical viewport. Live
review caught crowded shared resource-form fields: UI-153 moves spacing to
the actual fieldset and locks the rendered gaps. Intentional admission,
source-limit, cancellation, Create-guard and adoption regressions were observed
failing their locks; the restored adoption path passed again in the browser.
Unsigned arm64 packaging and the complete executable smoke passed. The new
native-dialog-result fixture keeps selected-file reads, trusted IPC, emitted
workers, explicit review/adoption and keyed creation real; exact saved bodies
are checked before all three source files are removed, then their identities
and rendered bodies survive a full app relaunch. The existing separate
OS-backed auth/provider/MCP credential, managed-backup, input/export and schema
worker checks also passed. This does not claim actual macOS dialog interaction,
signing, notarization, native Intel or paid-service acceptance. The preceding
provider-onboarding revision's GitHub CI run `34434648778`
is also confirmed successful; the new revision requires its own complete gate.

The preceding checkpoint completed the provider-onboarding failure path needed
for a reliable first conversation. The form now loads its saving/recovery
controller before accepting intent. A real browser module failure previously
stranded Create; consolidating the queue removes that late dependency.
Each activation freezes its user, tenant and account generation before native
credential provisioning. The native continuation, HTTP create/recovery and
ordinary provider-registry refresh all retain that source. Server-side source
checks precede collection/by-ID reads, registration and one-time-secret replay, so a
cookie changed in another tab cannot redirect intent or populate an old viewer's
cache with the new viewer's private registry.

Credential cleanup now distinguishes a never-submitted key from a possibly
committed submission. After any uncertain attempt, even a later definitive
refusal cannot prove the earlier request did not use the key; startup
reconciliation retains that responsibility. Failure-first tests exposed both
the delayed-native account-switch POST and this refused-retry cleanup defect.
Shared form/secret-dialog layout also reserves the live workspace below shell
notices and scrolls only its body, keeping titles and footer actions reachable.
The browser locks observed the short-window footer overflow and narrow recovery
banner overlap before their fixes.

That checkpoint's acceptance passed the complete five-lane verifier: 3,396 Node
tests and 356 browser tests, type checking and production build, with startup
budgets unchanged. The final frozen-tree responsive sweep covered 135/135 cells
with zero violations or skips. Its 137 fresh originals are distinct from five
historical captures; fifteen provider-state and ten search-state originals cover
the additional ceremonies at every canonical viewport. All 162 current originals
were individually inspected at full resolution with no remaining visual findings.
Search display now sits behind a local announced loading/failure boundary to
make room for the ready safety path. Failure initially focused Reload; a
failure-first browser lock now requires safe Close focus, trapped Tab, dismissal
and actual full-navigation recovery from a rejected module URL.
Unsigned arm64 packaging and executable smoke passed again on the final code,
including OS-encrypted credential lifecycle, personal defaults/sign-in/token
recovery across a different-origin relaunch, managed backups, artifact creation
and exports, native-reader/IPC input fixtures, and the isolated MCP schema worker.
These fixture-driven native checks do not replace actual OS-dialog acceptance.
Earlier browser/sweep runs were rejected for coverage gaps or extra document
reloads during edits. The final unchanged run passed without retries or extended
budgets; the harness now retains bounded reload/navigation diagnostics and waits
for the canonical artifact subject under its existing readiness deadline.
Artifact-removal policy is now approved in default 3 above; this checkpoint did
not implement deletion. Signing, notarization, native Intel,
external-service and paid-provider acceptance gates remain open below.

The preceding checkpoint closed a desktop first-conversation continuity defect:
the native host deliberately selects a fresh loopback origin on relaunch, while
personal model defaults previously lived only in that origin's browser storage.
Provider, model, effort and mode choices now belong to one revisioned user-and-
workspace server record, persisted through both JSON and SQLite. Setup waits
for that exact acknowledgement before returning to the draft; Customize and
the composer share the same held choice and explicit recovery. Saved sessions
retain their own routing, and tenant-wide registry defaults remain a separate
concept. Unowned legacy browser preferences are not automatically imported.
Sparse Retry preserves unrelated newer settings, and account-scope mismatches
cannot silently write another viewer's defaults. The workspace waits for its
own preference read and offers a full Reload when the initial identity crosses.
This is required desktop workflow continuity, not cross-device polish; live
hosted preference synchronization remains future work. The model catalog loads
on demand under the unchanged bundle budgets. Preference saving is ready with
the workspace: browser failure injection proved that resetting a lazy-import
Promise could not clear the browser's rejected module URL. Removing that extra
boundary avoids accepting edits that depend on a failed code download.
The same real-browser failure-injection audit remains required for other lazy
action runtimes: resetting a JavaScript Promise in unit tests alone does not
prove recovery from a rejected browser module URL.

That checkpoint's acceptance on 2026-09-10 passed the complete five-lane verifier,
including 353 browser tests under unchanged startup bundle budgets. The final
responsive sweep covered 135/135 cells with zero violations or skips; timestamps
distinguished its 137 fresh captures from five historical files. An additional
31 individually reviewed captures cover model preferences, held/error/recovered
choices and lazy catalog loading/failure. This review caught recovery notices
covering the top of a picker on narrow and short screens. The shared popover
funnel now measures the available workspace below shell notices and observes
its live size; source and browser locks were watched fail before the fix.
Unsigned arm64 packaging and executable smoke passed, including exact personal
default recovery and a usable fresh draft after a full relaunch on a deliberately
different loopback origin. Existing OS-backed credential, backup, artifact
export, input and MCP schema-worker checks also passed. This is not signing,
notarization, native Intel, paid-provider or complete actual OS-dialog evidence.

Current shared-browser handoff leaves all six demo accounts stacked with Ada
active on Artifacts in a desktop/light viewport. The New artifact form was
reviewed and cancelled without saving sample content; Ada's Acid Plum palette
and three overrides remain intact. The admission states are account-neutral;
existing isolated creation and download tests cover Ada's owner, Grace's
shared-reader and Maya's foreign-account faces. That earlier review could not
perform a fresh actual OS-dialog ceremony while the Mac was locked. Native
controls were available for the October 4 review below; Excel-application
acceptance remains a separate unverified check.

The [2026-09-10 native-context review](acceptance/native-context-2026-09-10.md)
used the unsigned arm64 packaged app and actual macOS Files, Photos, and Folder
dialogs. Cancellation, text/PDF/DOCX/XLSX/PPTX/image/folder import and preview,
model delivery, and full relaunch with the original input paths absent passed.
Exact stored identities/content and the model's text/image payload survived.
Independent native detach passed for Markdown, DOCX, and PDF in that review.
The [October 4 follow-up](acceptance/native-context-2026-10-04.md) freshly imported
and independently detached XLSX, PPTX, PNG and folder snapshots and verified a
final attachment-free model request. These dated, revision-scoped records are
qualified development-artifact evidence, not every native acceptance cell on
one current artifact, a paid-provider pass, or a signed two-architecture release.
No dialog policy was changed to accommodate the automation surface.

Shared editor review resumed on 2026-09-09 after the Mac became available. A
fresh tab preserves all six stacked accounts with Ada active, a desktop/light
viewport, and the edited `production-review.Q1.slides` artifact. Save and the
updated PowerPoint download were exercised. The review caught a split-line Add
bullet glyph/label; the shared inline-action style and failure-first UI-147 locks
now cover every structural add control.

Direct-authoring review on 2026-09-09 inspected the shared New artifact form and
slide fields with Ada active. The preview safety gate refused a persistent test
save, so the unsaved review form was cancelled and no sample row was added to
that workspace. Ada remains signed in on Artifacts with all six accounts
stacked; isolated browser and packaged tests provide creation/relaunch evidence.

| Milestone | Evidence and remaining work |
| --- | --- |
| Trustworthy local host | Sandboxed Electron, clean first run, SQLite, managed backups/restore, provider-key lifecycle, and native recovery are built. The signing root now persists separately from product data; packaged acceptance covers sign-in, token recovery, and a completed conversation across a full restart. |
| Useful first conversation | Provider onboarding and the Messages transport are built. Local text reaches both endpoint and Session transports as whole files (64 KiB per file, 128 KiB total, first 24 items), with shared-plan UI and one input snapshot reused through the tool loop. Browser/native intake shares source/configuration recognition and strict whole UTF-8 decoding. Bounded top-level folder snapshots (CTX-FS-11), direct-file PDF text extraction (CTX-FS-12), bounded DOCX text extraction (CTX-FS-14), bounded XLSX visible-value extraction (CTX-FS-15), bounded PPTX slide-text extraction (CTX-FS-16), and the bounded image path now extend the same input plan. DOCX is limited to 8 MiB/file, 24 MiB/selection, 512 entries, 4 MiB parts, 16 MiB expanded content, 128 XML depth, 128 attributes/tag, 100,000 nodes and 64 KiB body text; it excludes images/layout and legacy or macro-enabled Word files. Images accept PNG/JPEG/GIF/WebP up to 8 MiB raw, normalize the first frame to PNG at a 2,000 px maximum edge and ≤3 MiB, retain durable tenant-scoped asset references, and deliver at most 8 images/8 MiB per turn alongside the shared 24-item plan. Native folder/Git and served cloud/mapped-runner text, folder, document and image snapshots now provide explicit saved model input; CTX-FS-26 retains exact image originals privately. Bounded macOS local-image OCR (PORT-26) is implemented and accepted for the stated macOS path. Discussion-as-Context (CTX-DISC-1) adds confirmed saved copies under its bounded checkpoint; PORT-28 separately adds explicit macOS scanned-PDF-to-Document review; non-macOS and automatic PDF-attachment OCR, broader PDF recognition accuracy/language acceptance, unsupported document formats, rich Office fidelity, live/recursive source browsing, richer Git tooling and paid-provider acceptance remain future work. Targeted text/PDF/DOCX/image tests and XLSX acceptance, packaged executable smoke and the 135/135-cell responsive sweep cover this bounded path. Shared interactive preview handoff is restored as recorded above. Provider proof is deterministic protocol evidence, not paid-model acceptance. |
| Useful external work | Tenant-owned HTTPS MCP lifecycle, inspection receipts, Contexts setup and OS-encrypted desktop credentials now compose with isolated schema admission, exact attachment and per-call owner approval on both model transports. The running receipt precedes one outbound attempt; bounded inert results, known failures and restart-safe uncertainty retain honest history without automatic replay. Deterministic browser protocol fixtures and JSON/SQLite tests prove the portable workflow; packaged OS-storage and schema-worker checks are separate from combined real-service/native acceptance. Legacy development connectors remain mocked and other release adapters remain unconfigured. OAuth, local transports, standing trust, MRTR and third-party acceptance remain required. Repository content/git and some imported artifact renderers remain declared fixtures. |
| Distributable preview | The paired release verifier is built; both architecture candidates still need actual signing/notarization credentials, native execution evidence, and an authenticated download destination. A green browser CI run does not prove a signed release exists. |
| Hosted service | Preserve the boundary now; defer anonymous indexing, broad cross-device polish, and deployment-specific tenancy operations until the desktop preview's core workflows pass. |

## Earlier checkpoint evidence

The next routine-output increment first closes a demonstrated queued-intent
defect: execution froze the routine definition but read standing artifact and
extra-tool choices from the live graph. New runs now persist those choices
before dispatch; additional approvals apply only to future runs, and changed
approvals fail before execution and again at publication. Legacy queued work
cannot infer standing authority from a newer graph. JSON/SQLite restart and
direct store tests preserve the last good document; intentional bypasses of
the approval fence and snapshot admission each failed their new locks.
Final review also found deletion leaving standing graph approvals behind.
Deleting a routine now clears those choices and detaches only its write binding
from saved artifacts, preserving their content, names, sharing and original run
provenance. Same-ID recreation cannot inherit the old approvals or overwrite
retained output; restart coverage observes the cleanup before invalidation.
Startup also prunes orphan approvals and retired write bindings left by older
versions, persisting that recovery before request admission; live routines and
saved report content remain intact.
Structured routine output now extends that boundary to Document, Sheet and
Slides. The existing conversation approval names the format and output; queued
runs freeze both. Documents retain the bounded prose path, while sheets/slides
submit one validated literal body through the existing guarded model loop.
Failed, missing, duplicate or revoked output cannot replace the last good body.
Same-format refresh preserves identity, independent sharing/filing and user
names. Changing an already-published output's format refuses before altering
the grant until the outstanding identity-policy decision is resolved; the
conversion workflow remains required, not dropped. Browser acceptance uses a
test-owned Messages endpoint and is not paid-provider or signed-release proof.
Final review tightened current queue snapshots to object-or-null output specs;
bare names remain compatible only at the explicit legacy graph/snapshot doors.
The 135-cell responsive sweep passed without violations or skips. The additional
three-format owner/reader review exposed a misleading Workflow edit affordance
for shared readers; the owner-only rendering and browser absence/presence locks
now complement the existing server authorization wall. Shared preview review
left all six demo accounts stacked with Ada active and added no test artifacts
to that workspace. All ten targeted routine browser tests passed, including
all three output formats, owner/reader live refresh, and acknowledged editing.
Unsigned arm64 packaging and executable smoke passed with OS-backed credential
and authentication relaunch, managed backups, direct artifact creation/exports,
native attachments and packaged MCP schema checks. The complete repository
verifier remains mandatory before push; this is not signed/notarized or native
Intel release evidence.
The additional 120-capture output matrix was individually reviewed; regenerated
owner/reader workflow and list captures close the reader edit finding and the
short-viewport capture-readiness gap. The full browser run passed all 344 tests,
but its coverage guard rejected a dynamic three-case declaration counted as one.
Those cases now use three explicit declarations over one shared test body, so
the manifest remains exact without weakening the verifier.

The dependency audit is no longer blocked: on 2026-09-09 the development-only
Browserslist and baseline-browser-mapping findings were resolved with compatible
lockfile updates. Both production-only and full dependency audits reported zero
vulnerabilities, and a clean Node 26 install completed. The complete verifier and
native packaging remain the checkpoint gates; an audit does not substitute for
runtime evidence or guarantee the absence of undisclosed vulnerabilities.

CI on the preceding MCP revision exposed a test-isolation defect: the in-process
MCP browser router did not inherit the shard's model endpoint, so a shared local
development model masked its fallback to port 8788. The fixture must pin its
test-owned endpoint independently of ambient configuration, with a deliberately
invalid ambient endpoint proving that regression. Increasing retries or timing
budgets is not a remedy; the corrected complete verifier remains a release gate.
The same review exposed a responsive capture race: pane controls were selected
from the previous layout immediately after resize. MCP captures now await the
requested overlay tier (or its absence on desktop) before choosing Close.

The direct-authoring checkpoint extends New artifact to Document, Sheet,
and Slides. All three create real content without requiring a model proposal;
structured creation reuses the saved editor fields and keeps per-format drafts
independent. Direct creation has an account-scoped durable request identity,
allowing distinct same-name artifacts without weakening model-save replay.
One held form and shell recovery keep the submitted request until exact server
truth; a late result cannot navigate an unmounted originating form. The source
account is frozen at activation and checked before effects, including when a
different tab changes the shared sign-in cookie. The full verifier passed all
five lanes, including 337 browser tests, with first-attempt trace retention.
The responsive sweep covered 135/135 cells with zero violations or skips;
all 142 sweep, 15 creation-form and 84 saved-editor captures were individually
reviewed, with no confirmed visual findings after exact-file rechecks.
Packaged unsigned arm64 acceptance passed exact document/sheet/slides creation,
same-name identity separation, malformed-payload retry, and canonical-body
recovery across a full relaunch, alongside the existing vault/input/export
checks. Signing/notarization and native Intel acceptance remain separate gates.

The current core checkpoint builds one remote HTTPS MCP tool called from an
interactive conversation through explicit owner approval, stable catalog and
argument identity, and a durable bounded result/uncertain-execution receipt
(MODEL-36). Both model transports share exact attachment, schema declarations,
argument validation and inert outcome history. Every call requires approval;
the running receipt commits before credential or network work, and an interrupted
call becomes durable uncertainty on restart rather than being replayed. Catalog
schemas compile in bounded, cancellable workers; no remote references are fetched.
Unsupported tools remain inspectable but cannot become model capabilities.
Conversation lifecycle preserves unresolved external work: deletion waits for a
running call, while summarization and copied fork history require proposed or
running calls to be resolved first. These guards protect the original durable
receipt instead of creating a second execution or an orphaned approval card.
Focused protocol, model, route-race and persistence tests accompany the workflow.
Checkpoint acceptance requires the complete verifier, responsive surface/account
matrix, packaged executable smoke and adversarial final diff review. The native
schema phase exercises the actual ASAR validator, including deadlines,
cancellation and capacity recovery; it is not combined third-party execution
acceptance. Broader trust, local transports and standing execution remain required
later work, not omissions. A real third-party acceptance target and any policy
that waives per-call approval require an explicit owner decision.

Structured artifact authoring now uses the same save proposal and exact-ID body
store as documents. Sheets carry literal rectangular values; slides carry ordered
titles and bullets. One strict shared parser bounds shape, counts and 20,000 total
UTF-16 characters before consent or persistence; invalid content is rejected as a
whole. Consent and saved pages share one renderer, including keyboard-scrollable
wide tables and wrapping long text. The HTTP/MCP read wall, rename/replay identity,
JSON/SQLite restart and portable-state validation preserve these actual bodies.
Owners can now correct a saved sheet or slide deck on its canonical page. One
local draft holds literal headers/cells/note or ordered titles/bullets, including
structural add/remove and slide reorder controls. Save replaces the complete
body against the revision reviewed when editing opened; Cancel leaves saved
content unchanged. Conflicts keep the draft beside the latest saved version:
explicit Retry replaces that version, while Dismiss keeps the draft editable.
Readers remain read-only, account changes clear held intent, and downloads wait
for the edit to finish. Prose and structured edits update the existing Edited
timestamp through one body commit, without advancing independent name ordering.
JSON/SQLite preserve edited bodies, timestamps and revisions without changing
names, grants or immutable save provenance. New slides begin without invented
blank bullets; explicitly authored blank values remain lossless. Spreadsheet calculation
and arbitrary layout/styling remain required. Structured standing-routine output
is implemented and verified under REL-13 / MODEL-29; the older wording here had
incorrectly continued to list it as missing.

Adversarial review closed two follow-on gaps: accepted body acknowledgements
refresh artifact metadata even when ambient sync is unavailable, and all new
authored names share the metadata validation boundary. Older invalid names stay
readable and can be renamed; edits and proposal landing cannot synthesize an
invalid metadata row that would prevent the next JSON/SQLite restart.

Saved slides now export editable PowerPoint files through explicit `format=pptx`
on the same read-authorized artifact export door. The fixed 16:9 design uses
native title and bullet objects, 32-point headings and 24-point body text. Dense
content continues onto marked pages instead of shrinking or dropping words;
no cover, images, external relationships or macros are invented. Source order,
literal Unicode and whitespace remain, with CR/CRLF mapped to native line breaks.
XML-illegal control units refuse the complete export without changing saved text.
The shared Office decoder now has separate XLSX (2 MiB) and PPTX (8 MiB) ceilings;
maximum accepted hard-break content exercises the PPTX size bound. Empty run
redundancy was removed after that limit test failed on unnecessarily large XML.
Independent package/layout validation and six individually reviewed imported
renders supplement behavioral and browser locks. These checks do not establish
native PowerPoint application acceptance or fidelity to arbitrary imported decks.
Arbitrary slide styling/layout, spreadsheet calculation, external execution and
signed-release acceptance remain required, not replaced by these export paths.

Saved sheets now have a real XLSX download through the existing artifact export
read. Explicit `format=xlsx` selects a values-only workbook; omission retains
Markdown compatibility. Headers, rows, empty strings, leading zeros, Unicode,
formula-looking text and the optional note retain literal string meaning, without
type inference or formula execution. Shared strings, wrapped cells, fitted widths,
a frozen header and filtering keep ordinary workbooks readable; Excel's own
409-point row ceiling can limit visible text without truncating stored cells.
Exact identity and current access are checked before serialization and again
after its async work. Browser and packaged downloads use the same portable API.
Independent workbook import/render supplements ZIP/XML and HTTP/MCP locks.
The bundled renderer does not faithfully display Xstring escapes or numeric-looking
literal text. A separate openpyxl read verifies the exact values, string types,
text formatting, frozen header and filter; contract tests cover all UTF-16 edge
cases. Actual Excel application acceptance remains unverified.

This checkpoint passes the complete five-lane verifier (324 browser tests), real
unsigned packaged-Electron acceptance, and the separate 135/135-cell responsive
sweep with zero violations or skips. The packaged download is compared byte for
byte with the authenticated API export; this is not evidence of a signed release.

Artifact renaming is an owner-only metadata workflow. Names have independent
revision ordering, while IDs, document bodies, links, filing, grants and immutable
save provenance remain stable. A routine refresh preserves the owner's display
name without changing its standing configuration. Original save proposals remain
recognized after renaming, including restart replay. Exact read/PATCH doors share
the HTTP/MCP wall, and late acknowledgements cannot rewind newer name or source
data. The inline editor holds its draft through conflict or transport loss and
uses the existing explicit Retry/Dismiss recovery. JSON/SQLite and portable-state
locks cover the additive metadata slice; deletion retention remains undecided.

The saved-document export checkpoint adds a fresh authorized Markdown download
to the canonical Content section for documents and draft emails, including
standing routine reports. It exports the latest saved revision, not an unsaved
editor or retained body cache. Browser retry/revocation checks and an actual
packaged Electron download complement serializer, identity and HTTP/MCP locks.
Addressed body/proposal readers now use exact IDs, preventing metadata-only rows
from borrowing demo text through a matching filename. Rich sheet/slide layout,
external tools and signed release remain required.
Legacy demo workspace previews receive explicit code-owned seed-ID projections
behind the live session read wall, never a generic filename fallback.
Artifact removal now follows approved default 3 above. Implementation must
preserve shared review history and define routine report regeneration behavior;
this earlier export checkpoint did not implement deletion.

Packaged acceptance exposed a send/detach race: the next turn could snapshot
old attachments while an earlier context update was still unacknowledged.
The shared composer now holds during pending/failed context intent, retaining
typed text; the transport boundary independently refuses overtaking sends and
keeps their logical retry. Delayed-detach browser and same-tick core tests lock
this ordering without hiding the defect behind a test-only wait.

The routine document-delivery checkpoint replaces metadata-only standing saves
with bounded model-authored report bodies. One stable routine binding preserves
the document across runs and renames, under the routine's actual tenant. Body
revision, synopsis, latest-run provenance and terminal status commit together;
empty/failed output preserves the last good document. Readers refresh metadata
and body through the artifact read wall without receiving private relation
payloads. The accompanying authorization fix walls every routine relation write
and filters foreign routine bindings from the graph. Direct store, route,
JSON/SQLite restart, failure-publication and live two-reader browser locks cover
this slice. Rich sheet/slide authoring, external tool execution and signed release
acceptance remain required, not replaced by this checkpoint.

The Project registry checkpoint extends the canonical discovery boundary to
authored Projects. The HTTP/MCP list and graph acknowledgements now share one
viewer projection, including current public prose and distinct org-member /
org-owner controls. Search includes directed grants without duplicate hits, and
the directory reflects description edits. Project and artifact UI merges use
one opaque-ID union. Model aliases distinguish owner edits from shared-project
commissioning; granting read access is not granting either write authority.
Shared-list guidance reflects that distinction. The visual sweep selects an
explicitly owned Project for owner-only sharing checks, never the first visible
row; independent reader walks still prove those controls are absent.
The follow-on live Project checkpoint adds an id-only scoped invalidation for
effective sharing, public-description, default-role and commission-cap changes.
Unsharing reaches former public readers; private hints use current read authority
on delivery and replay. Private relation payloads remain private. Canonical and
dependent Project reads refresh instead of trusting event content, and publication
follows durable commit. This does not change durable membership storage.
Store, HTTP/MCP wire, persistence and cache locks cover these boundaries; the
browser walk exercises already-open owner, granted-reader and public-directory
views through sharing, prose edits/clears, unsharing and revocation. Independent
discussion pages withdraw and reappear with their Project; the shared cache
clears authoritative API not-found results without erasing data on transient
failures. Project grant events reuse the same dependent-read refresh, so a
directed revocation also withdraws an independently opened discussion.
Checkpoint acceptance includes the complete verifier and responsive
sweep alongside these focused locks.
The full production goal and all remaining integration/release milestones stay
in force; shared interactive review still requires an unlocked Mac.

The authored-artifact discovery checkpoint closes a gap masked by the UI's
relation-graph merge: `GET /artifacts` and remote MCP now list actual authored
documents alongside fixtures. Current filing/unfiling is projected, same-name
IDs remain distinct, grant-only rows omit raw owner tenant identity, and the
model's filing catalog includes owned targets only. One ID union keeps UI and
body-cache projections duplicate-free while acknowledged creation stays
immediate. Grant/revoke refreshes already-open list and body reads. Focused
store/route/MCP locks and the five-viewport owner/shared/foreign browser walk
cover these boundaries; duplicate concatenation and omitted grant invalidation
were deliberately restored and observed failing. This is not a new rich-format
authoring engine or paid-model acceptance. Shared interactive preview review
still needs an unlocked Mac.

Each milestone records its implementation and behavioral locks in the spec
ledger, proves a relevant regression fails, runs the full verifier, and reviews
the diff before landing. Native changes additionally run the packaged executable
smoke; UI changes receive signed-in live review. Real-provider acceptance must
be identified separately from tests using the deterministic Messages fixture.

Revisit this order when a core journey reveals a blocker or the owner changes a
product direction. Do not treat the remaining partial cross-device requirement
as an instruction to harden every mutation before shipping useful desktop work.

The completed local-text checkpoint (`b31570a`) removes basename-based attachment loss:
same-named selected files now keep independent snapshots through preview,
reload, model input, and removal. Adapter regression tests were observed failing
before the fix, and a browser chooser walk verifies the complete text journey.
At that checkpoint, the full verifier passed all five lanes (277 browser tests), and packaged
Electron verification passed. Packaged attachment acceptance now crosses the
native reader and IPC into the actual renderer, endpoint transport, durable
conversation, and independent removal. Two same-name files retain their exact
IDs and bodies across relaunch after both source files are deleted. This phase
fixtures only the native dialog result and model response; the actual OS dialog
still needs manual review. It uses a separate profile because Playwright's
Electron launcher adds mock-keychain switches; real OS-backed storage acceptance
remains in the unchanged ordinary executable smoke. An intentional mutation of
the packaged native text return was observed failing at the rendered preview.
At the local-text checkpoint the shared preview was available, with all six demo
accounts stacked. Interactive OS-dialog review remains unverified: browser
file selection failed when the control tool lost the input node, and native
window actions were unavailable. These are limits of the review evidence, not
confirmed product defects; the packaged dialog-result-fixture acceptance above
must not be described as a manual OS-dialog pass.

The owner delegated sequencing on 2026-09-07: all planned core capabilities
remain required. Bounded local folder snapshots and direct-file PDF text imports
are built. The live-folder/Git read-access lifetime now follows approved default
1 above; remembered connections are not yet claimed as implemented. Image OCR, other
document formats, live access and remote inputs remain required; sequencing is
not a scope reduction. Signing/notarization credentials
and a download destination remain separate release prerequisites. Dependency
advisory checking also awaits permission to send dependency names and versions
to npm's advisory service; an attempted audit was denied and was not retried.

The DOCX increment adds the pinned `@zip.js/zip.js` 2.12.0 archive decoder and
its XML companions `saxes` 6.0.0 / `xmlchars` 2.2.0. They are required to keep
ZIP/XML parsing bounded and isolated in the renderer worker; their exact
third-party notices are emitted into both distributions. The saxes npm tarball
omits its license, so the exact v6.0.0 upstream text is vendored with a strict
version gate rather than silently reused for a future upgrade. Any dependency
upgrade requires a deliberate notice and bundle-budget review.

## Open verification follow-ups

The saved-version-search checkpoint reproduced native profile admission timeout
under the Node runner's default 16-worker load, with or without browser lanes.
Test-only diagnostics captured `ETIMEDOUT`, `SIGTERM` and no helper output at
the unchanged five-second boundary. All 15 profile checks passed in isolation.
Moving its compiled executable out of the shared development path removed an
independent fixture-isolation problem but did not cure the loaded timeout.
The identical complete Node suite at four workers passed all 4,595 tests, with
the formerly failing admission taking 871ms. Local npm tests now declare four
workers and the complete verifier derives the same setting from that one script;
strict parser/wiring tests preserve full suite coverage. Real ACL inspection,
production deadlines, assertions and zero automatic retries are unchanged.
This supports bounding verifier contention, not a claim about the precise OS
delay or every native startup environment. Keep helper outcome diagnostics for
recurrence. Failed verifier browser lanes were deliberately interrupted; only
a subsequent complete frozen-tree run counts as checkpoint acceptance.

The release-feed checkpoint observed one first-attempt timeout in
`e2e/mcp-tool-execution.spec.ts` (long external labels): after Enter, neither
the user message nor the proposed tool call appeared. The reconnecting banner
is expected because this fixture intentionally aborts live events. The unchanged
trace-enabled complete verifier passed all 432 tests, as did twelve focused
repetitions with always-on tracing; a successful trace confirms the message POST
returned 200. There is no failure trace establishing whether the original send
was issued or later state was replaced. Keep this unresolved; capture the next
failure's request and transcript sequence before changing product logic, test
readiness, timeouts or retries. No speculative MCP fix is included here.

Read-only MCP inspection now recovers once when a legacy peer expires its
initialized session during catalog listing. It retires the old private ID,
initializes without it, and restarts the catalog without old pages or cursors.
The deadline, page attempts, processed tools and catalog bytes remain cumulative;
stateless/modern/authentication failures never renew, and no tool call is replayed.
HTTP peers cover all supported legacy versions and bare/correlated 404s. Focused
tests cover cancellation, concurrent calls, replacement metadata and cleanup;
intentional regressions in renewal, both size budgets and metadata each failed
their locks before restoration. This completes a discovery recovery path, not
MODEL-33's schema semantics, trust policy, durable execution receipts or actual
third-party acceptance. Production loopback and the new validator dependency
still await owner decisions.

The first complete gate caught the shared PPTX contrast scan accepting the old
phone overlay during a phone-to-tablet resize. The three Office walks now share
one readiness helper that proves the exact rendered tier, full ancestor opacity
and stable geometry across paints before the unchanged WCAG scan. A traced full
run also exposed a relay image test accepting its deliberately short parking
window's idle sentinel as a prompt; that test now follows the protocol's
argument-free wait before inspecting the complete image-bearing content. Neither
repair changes product colors, motion, relay behavior or acceptance thresholds.
The wrong-tier assertion and bypassed idle wait were each observed failing at
their exact rendered-tier/image-content locks before restoration.
The previous accounting checkpoint `f820afd` is green in GitHub run `34246731218`.

The per-call accounting checkpoint closes a demonstrated loss of usage when a
completed model response was followed by cancellation, failed compaction, or a
later provider error. Reply, routine and compaction drivers now persist each
completed call before tools or more model work; returned totals cannot be
recorded again. Session-provider counts remain character-based estimates, now
accumulated per completed response rather than only the last round. Failed
accounting stops the loop and cannot trigger an automatic routine retry.
Endpoint, route and routine failure-first tests expose the old missing reports
and retry behavior. JSON and SQLite process-restart tests preserve an exact
completed-call count after a subsequent provider refusal. Partial streams with
no complete response, provider invoices and concurrent reservations remain
separate accounting gaps; subscription ceilings and access policy are unchanged.

The PPTX increment extends direct-file input to bounded slide-text snapshots
using the existing Office ZIP/XML worker and dependencies. Presentation order
and original slide numbers are retained; within each slide the import follows
file order, not guaranteed visual reading order. Ordinary text boxes and table
cells contribute text; hidden slides/shapes, speaker notes, comments, master or
layout text, charts, images and animations do not. This is not a slide renderer
or presentation editor. The file/selection/archive/XML/text limits remain those
of the shared Office path, with a separate 128-slide ceiling and no partial
success. Browser and native intake now each use one format-adapter table and
one bounded read path, keeping admission checks consistent as formats expand.
Manual signed-in preview and OS-dialog review still require an unlocked Mac;
deterministic provider fixtures are not paid-model acceptance.
The targeted 13-test browser gate covers all four document types, including
PowerPoint owner/shared previews at all five viewports, the foreign-tenant wall,
exact model-text parity, reload and detach. Review tightened ordinary text
recognition to exact XML paths: extension/compatibility branches cannot import
familiar-looking text tags, and hidden owner flags mask the complete subtree.
An intentional path-admission regression leaked the test's extension marker
and failed the new lock before restoration. Shared intake overread, native
PPTX admission and model/copy locks also have observed failure-first evidence.

The XLSX checkpoint extends the first-conversation path with bounded visible
worksheet values, exact sparse cell addresses and explicit cached-formula
labels. It never calculates formulas, reveals hidden sheet/row/column content,
or retains archive bytes or file access. Dates and formatted numbers may remain
raw stored values; this is not a spreadsheet editor or calculation engine.
It uses the existing pinned ZIP/XML dependencies, with one shared Office worker
and package reader for DOCX/XLSX. Limits remain 8 MiB/file, 24 MiB combined
document selection and 64 KiB output; workbook structure additionally caps
32 sheets and 10,000 cells/shared strings. The existing bundle budgets remain
unchanged. Parser regression checks caught empty cached strings being reported
as absent and zero dimensions being missed under alternative numeric spellings;
both now have failure-first locks. Acceptance exercises preview/model parity,
shared read-only views, the tenant wall, persistence, relaunch and detach.
The Mac remains locked, so shared signed-in preview and manual OS-dialog
handoff are still unverified; isolated automation is separate evidence.
The browser review also exposed two recovery/copy gaps: failed module imports
are cached, so the local picker now offers an explicit reload with unsent-text
guidance; a resolved provider registry missing a shared conversation's private
model must report unavailable access instead of an endless checking state.

The usage checkpoint replaces restart-reset plan meters with tenant-owned
durable counters and original period anchors. Existing ceilings and demo gauges
are unchanged; clean/new accounts start at zero, and older snapshots acquire
their world-appropriate baseline once. JSON/SQLite restart locks cover exact
spend, independent five-hour/weekly resets, tenant isolation, invalid-state
refusal and failed-write fencing. Packaged acceptance now compares a real
completed fixture-provider turn's exact counters and anchors across relaunch.
These are local operational counters: provider invoicing, unreported in-flight
spend and concurrent-call reservations remain separate accounting work, and an
explicit older backup restores its recorded counters along with other data.
Intentional regressions proved that removing the usage commit, retaining stale
tenant meters on rehydrate, admitting malformed usage, or dropping the packaged
restart assertion each fails its corresponding lock; all were restored.
Review also removed read amplification: checking a new tenant's gauge or gate
does not retain an empty meter; its first reported spend establishes the period.
The store-level lock also failed when read-time retention was reintroduced.
A second failure-first lock caught rejected first-turn counts retaining an empty
tenant. Registry recording now validates before publishing any new tenant meter.

Live native MCP inspection/replacement acceptance still needs an approved public
HTTPS test endpoint. Production loopback remains disabled; the existing native
MCP smoke's offline seeded catalog is not live discovery evidence.

The legacy SSE resumption increment keeps one logical request through bounded
read-only GET recovery: at most eight connections, one original deadline and
cumulative response-byte budget, exact private cursor/session/audience, and no
POST replay. Server retry intervals are honored; cancellation during backoff or
an active GET keeps the original request's uncertainty and exact cancellation
identity. Local peers cover all supported legacy versions, initialization and
stateless streams, while modern requests remain non-resumable. This advances
the protocol substrate only; schema semantics, attachment, approval, durable
call receipts, execution-specific expiry recovery and actual service acceptance remain.
Intentional mutations proved the GET cap, shared byte budget, modern no-resume,
complete-event cursor and server retry locks fail before restoration. The prior
cancellation checkpoint `ddd2217` is green in GitHub run `34225716157`.
The resumption checkpoint `cd55070` is green in GitHub run `34228524077`.
The durable-usage checkpoint `976a142` is green in GitHub run `34232137832`.
The XLSX checkpoint `f968958` is green in GitHub run `34238430612`.

The explicit MCP cancellation increment notifies a legacy peer of the exact
submitted tool/list request when user cancellation wins. The control POST is
limited to one second inside the original deadline, cannot replay a tool, and
cannot replace the original outcome even if notification delivery fails or the
deadline expires. Completed responses and unsent requests never trigger it.
This removes a protocol gap; it does not establish remote rollback, enable
execution, or resolve the pending schema/trust/network choices. Its deadline
and outcome-preservation regressions were observed failing under intentional
mutations before restoration.

The MCP session increment shares protocol negotiation, the absolute deadline,
and private legacy cleanup between read-only discovery and one tool attempt.
It keeps known tool outcomes when cleanup fails and prevents scope reuse or
implicit call replay. Review found and fixed a late-cancellation race that
discarded an already-complete transport response; its regression was watched
fail first. This remains an unconfigured execution substrate, not a completed
external-work journey. Execution-specific session-expiry recovery, schema
semantics, approval, durable receipts and actual service acceptance remain.

The single-call MCP increment adds bounded request/result parsing and modern
body-derived parameter headers behind an unconfigured protocol boundary. Local
HTTP/SSE peers cover supported modern/legacy replies, tool errors, malformed
results, cancellation before/after submission, and refusal without replay or
continuation. Full schema semantics, per-call approval, durable uncertainty,
execution-specific session-expiry recovery and actual model execution remain required. No
third-party account or new dependency is involved in this increment.
Independent review found that the older HTTP request snapshot invoked caller
serialization hooks. The same strict JSON helper now owns that transport path;
the new regression was observed executing two hooks before the fix and none
afterward. Intentional mutations also proved the depth, result-admission,
static-header-path and post-submission uncertainty locks fail.

The native MCP acceptance increment now covers replacement-token reconciliation
after an offline binding switch, real vault-publication failure during a durable
disconnect, explicit cleanup Retry, unrelated provisional preservation, and
removal/orphan cleanup through relaunch. The rebuilt complete desktop verifier
passes, including this real Electron/OS-encryption phase. A focused filesystem regression was
observed failing when in-memory state advanced before durable publication, then
passing after restoring the runtime. No production policy or runtime behavior
was changed. Live inspection/replacement and interrupted acknowledgements remain
combined acceptance gaps; the offline catalog fixture does not prove them.
The exactly pinned, backend-only JSON Schema validator dependency decision has
been requested; it has not been treated as approval to install a dependency.
The first complete gate caught a native-smoke link in a context field reserved
for test/spec files, plus a browser fixture healed while inspection was still
pending. The latter's saved page already showed a successful catalog, not a
missing product Retry. A held-request reproduction fails when the peer heals
early; the repaired walk proves pending has no Retry, then waits for actual
failure before healing the peer. Both MCP form/layout tests pass unchanged
timing/retry limits. Prior main `fffb678` is also green in GitHub run `34214623391`.

The current lifecycle review closes stale list/detail acknowledgements, exact
removed-row recovery while native cleanup is pending, dismissible upstream
inspection refusals, and account-switched form admission. Project context
sources now retain their opaque identities through both page and rail doors;
foreign/phantom source admission is refused and label/source action keys cannot
alias. Shared-project owner-context redaction was already correct and gained a
behavioral lock, not a speculative runtime change. The new dialog, recovery,
empty/error catalog and same-label project browser tests exercise real routes
with test-owned protocol peers; production loopback policy is unchanged.

Focused packaged acceptance now runs inside the complete desktop verifier and
the extracted-release smoke, with its helpers excluded from ASAR. The frozen
unsigned arm64 artifact passes real authentication/Keychain, provider lifecycle,
text/folder/PDF/DOCX/image, and MCP credential acceptance. Its runtime and emitted
UI byte-match that checkpoint's workspace. Its full Node suite passed 2,854 tests. The frozen
responsive sweep passes all 135 cells with zero violations or skips; its first
run lost a navigation context and covered only 120/135 cells, so that run is not
a pass. The first combined single-shard gate passes checks and 295/300 browser
tests. Retained traces prove the five refusals hit the shared seeded tenant's
exhausted model quota before generation. History, image, PDF and responsive
send walks now own independent usage partitions, while the phone panel walk
explicitly returns to its separate seeded fixture. Production quotas, assertions,
timeouts and retries are unchanged. The follow-up single-shard run passes all
five repaired tests and 299/300 overall; its sole failure is an accessibility
scan interrupted by a concurrent documentation edit. The saved Vite websocket
message names `docs/mcp-client.md` as the full-reload trigger. This is workflow
interference, not a backup-panel defect or a reason to weaken the scan. The
entire workspace, including documentation, must remain quiescent during the
final complete verifier. The final frozen rerun passed all five lanes and all
300 browser tests before `fffb678` landed. The shared Mac remains locked.

Final credential review added two fail-first locks: a connected native channel
must reject startup synchronization errors rather than acknowledge ordinary
storage unavailability, and the renderer must validate the exact tenant/server
binding before provisioning a token. Credential-only validation stays on the
lazy native ceremony path, within the unchanged startup bundle budget.

GitHub run `34201856978` at `9caa11a` failed the live-pane pruning test after
the shared five-hour model quota was exhausted. The test now forks a completed
seeded exchange through the actual API, verifies its persisted messages, and
keeps the same split/delete assertions. Deletion-layout acceptance no longer
depends on unrelated model quota; this does not retroactively pass the old run.

The active core workflow is a real external MCP connection (MODEL-33). Saving,
inspecting, refreshing, disconnecting/reconnecting, and removing a connection
now cross real tenant-scoped routes and the UI. Desktop startup and provision-only
credential wiring are implemented; focused native acceptance proves real OS
storage, relaunch binding reconciliation, ordinary-read secret exclusion, and
disconnect cleanup without contacting an external service. The full
[MCP client plan](mcp-client.md) retains semantic schema validation, attachment,
explicit trust, durable uncertain-call recovery, and combined real-service
acceptance as required work. The owner has been asked
about per-call approval before explicit server trust; no answer has been
assumed. No real third-party account was contacted during these tests.
The preceding transport/discovery checkpoint passed the full five-lane verifier with all 292
browser tests. Focused regressions were observed failing for unsafe resolved
addresses, mismatched response IDs, success-shaped HTTP errors, CRLF byte-budget
undercounting, and environment-disabled TLS verification before their fixes.
The CI coverage-output test executes both intact and deliberately degraded
temporary runner copies; no real browser failure is claimed repaired by it.

Word revision `809274a` passed the full local verifier, but GitHub run
`34188381547` failed its browser coverage gate at 145 passes against 146 expected
in partition 1/2; checks and partition 2/2 passed. The successful Playwright exit
caused the runner to hide its output, and no browser artifacts were retained.
A retry-only pass is a plausible cause, not a proved one. CI now explicitly
fails flaky tests, keeps first-attempt traces and uploads only failed browser
artifacts for three days; coverage mismatch also prints the affected lane tails.
This fixes missing evidence, not the unknown underlying browser failure.

The next run, `34190219926` at `4a10c03`, retained the missing evidence:
partition 1 failed because the real Word-import journey passed only on retry;
checks and partition 2 passed. Its first-attempt trace shows a document reload
while the lazy DOCX worker discovers ZIP/XML dependencies. The optimized React
dependency hash changes across that reload, and no attachment write occurs.
The final page has neither a picker nor an attachment. A new cold-cache Vite
scan regression independently fails because the worker's ZIP dependency is
absent from the initial scan. The cold-cache browser reproduction also logged
the optimizer's explicit reload and failed the no-reload assertion. The
repaired Vite scan includes `index.html` and all source worker entries. Its
cold-scan lock and the browser journey now pass; the journey always owns a
fresh cache and a strict, shard-derived UI port. Runtime parser loading remains
lazy. No timeout or retry policy was widened.

The preceding MCP transport increment added a read-only discovery transaction with the
current metadata flow and three supported legacy initialization versions. It
uses one deadline, bounded pagination and an inert catalog snapshot, and closes
legacy sessions when possible. Wrong-id modern errors cannot trigger a false
legacy fallback; cancellation closes live sockets. These are tested protocol
boundaries, not evidence of tool execution. The current lifecycle increment
adds routes, user inspection and native vault wiring; semantic schema validation,
approval and execution remain required. Release fulfilment is still unconfigured.

GitHub run `34193269086` at `ea27486` completed with checks and E2E1 passing
and E2E2 failing. Its account-switch trace proves a different race: the session
read still names an active turn, that turn finishes before the stream reattach,
and the 404 recovery settles the controller before the authoritative session
refresh. The saved assistant reply exists but the UI retains a false interruption.
The repair makes that handoff one bounded, identity-fenced truth read before
releasing the composer or exposing Retry. A deterministic browser lock exercises
the missing real stream handle at all five canonical viewports; controller
locks additionally cover held reads, failed reads and history continuity.
This does not retroactively make the failed CI run healthy.

The associated review also found two concrete recovery risks: a delayed HTTP
body could cross an account switch after the header-time identity check, and
an indefinitely stalled reconciliation read could keep the composer busy.
The repair fences body completion and session-cache publication, and gives the
read a 30-second abortable deadline without retrying the send. Late and failed
reads cannot clear recovery or restore an outgoing account's session.

Packaged validation during this increment observed the PDF-detach reply missing
after the preceding authentication/Keychain, text, folder and Word phases passed.
A diagnostic run completed every packaged phase, but did not establish a cause.
The smoke now retains private, bounded best-effort failure evidence for that
exact handoff. A later packaged run recurred and captured an empty composer,
an acknowledged empty attachment list, and no new message/model request. A
held-acknowledgement browser regression then proved that removing a context
could remount the composer and erase unsent input. The repair keeps memory-only
text in the existing account-scoped conversation state and reconstructs its
multiline height after remount; it does not add browser or server persistence.
Explicit reset, submission and account disposal still clear that private text.
The rebuilt packaged executable now passes authentication/Keychain, text,
folder, Word, PDF and image acceptance, including the previously failing
PDF-detach send. The browser walk also exposed a 20px revealed rail filter
target; its shared owner is raised to the existing 24px accessibility minimum.
The five-viewport browser regression now passes multiline draft restoration,
single-send behavior and WCAG 2.2 AA checks, including same-document desktop
navigation. The full responsive sweep also passes all 135 cells with zero
violations or skips. The complete repository verifier remains the final gate
after review corrections; the locked shared Mac still prevents interactive
preview handoff.

The checkpoint's first complete gate caught the component index crossing its
line budget and a credential-channel test depending on a 10ms wall-clock race
under suite load. Redundant context prose was condensed without removing rules.
Credential timeout/order tests now advance the test clock explicitly; removing
the stale-completion identity guard still makes the request-ID-reuse lock fail.
Production deadlines and retry policy are unchanged.
Final review also caught coercive enum/ID admission in the MCP registry. Array
and boxed-string regressions were observed failing; scalar-only validation now
rejects those malformed records without replacing the saved registry.

The combined discovery/cold-import checkpoint passed all five verifier lanes in
147.1 seconds: 2,727 Node tests, typechecking, the production build and all 292
browser tests. The 47 focused MCP checks also pass. Regression proofs included
malformed modern JSON/SSE error recognition, version selection, cursor loops,
legacy cleanup, and the actual cold-cache browser reload. An initial full run
caught the added context rule exceeding its index budget; the historical prose
was condensed without removing rules, and the complete gate was rerun green.
Hosted CI confirmation belongs to the new pushed revision; the preceding failed
run is not retroactively marked healthy.

The PDF text increment uses exactly pinned PDF.js as a renderer-only lazy
parser, rather than hand-parsing an adversarial document format. It saves
bounded extracted text and explicit outcomes, never original PDF bytes. The
existing 500,000-byte UI chunk/async and 800,000-byte initial-graph gates remain
unchanged; emitted worker JavaScript has a separate aggregate 1,400,000-byte
gate (PDF.js worker baseline 1,220,555 bytes). Splitting workers cannot bypass
the aggregate gate. Closing intake cancels attachment and parsing, and releases
unattached image previews in mixed selections. OCR/layout/images and PDFs
inside folder imports remain outstanding, not claimed by this increment.
The build carries the installed PDF.js license and upstream notice into both
distributions; its renderer-only package is not copied into the native backend.
The rendered PDF walks cover Unicode and compressed text, genuine password
protection, empty/invalid/oversized documents, limits, cancellation and a stalled
worker. Packaged acceptance covers actual native bytes, the worker, exact model
text/metadata, relaunch without the original PDF and detach. Review caught and
locked stream-cancellation errors and unacknowledged cancellation; the complete
responsive sweep passes 135/135 cells with no violations or skips.

The DOCX increment follows the same path with a dedicated ZIP/XML worker: only
paragraphs, table cells, tabs and line breaks become bounded text; images,
layout, headers/footers, notes/comments and revision history, `.doc` and `.docm` remain
explicitly unsupported. Its archive, expansion, XML-depth/node, selection and
UTF-8 text limits are locked in pure extraction, browser/native picker, model
input and packaged smoke tests. The combined worker budget is now 1,400,000 B
(measured DOCX+PDF total: 1,309,617 B); the 500,000 B physical chunk and
800,000 B initial-graph limits remain unchanged.

Word acceptance now covers owner/shared/foreign views, 15 ready/omitted/shared
viewport states with WCAG scans, cancellation, the actual worker deadline, and
the packaged native reader/IPC/model/relaunch/detach journey. Source-file removal
before relaunch proves the saved body is durable. Exact-byte, moved-revision,
worker-loader, termination, strict-outcome and distribution-notice regressions
were observed failing before repair/restoration. The responsive review also
found a 2.54:1 grouped-chip count: its shared style now retains full contrast,
locked as UI-132. These are bounded document-text claims, not OCR, page-layout,
paid-model, manual native-dialog, or signed two-architecture release acceptance.
Final diff review also caught the new DOCX ledger row replacing the existing PDF
row. A reference-integrity lock was observed failing on the missing CTX-FS-12
before restoring the PDF row; both formats now retain their own requirement.

The bounded image-input path is implemented but is not a claim of overall
production readiness. It accepts PNG/JPEG/GIF/WebP in the browser/Electron
boundary (8 MiB raw), normalizes the first frame at a maximum 2,000 px edge to
PNG (≤3 MiB), and stores immutable tenant-scoped asset references durable in
SQL and portable backups. A turn may carry at most 8 images and 8 MiB, in
addition to the shared 24-item attachment plan. Endpoint requests carry
first-class image blocks; Session relay negotiates `images=1`, while old relays
omit images and receive honest metadata. Owner-context walls and shared-view
image reads are enforced. Packaged executable image smoke and the full
135/135-cell responsive sweep pass, including explicitly opened removal
confirmations. Ready, rejected, and shared image previews were reviewed at all
five canonical sizes. The review also corrected clipped Commons mention help,
complete-selection queueing, image containment, and error-text contrast, with
lasting source and browser locks. The complete repository verifier gates
landing. The shared preview cannot be handed back interactively while the Mac
is locked; unlocking has been requested. OCR, SVG/BMP/ICO, other document formats, live folder/Git and
remote-source input, paid-provider acceptance, manual OS-dialog review, and
signing remain outstanding.

The folder checkpoint imports real, bounded top-level text snapshots through
the same native/browser policy and model-input plan. Equal-named folders keep
independent identities through reload and removal. Hidden files and subfolders
are excluded; unsupported, oversized and unavailable content is explained rather
than replaced with demo bodies. Packaged acceptance proves native reading, IPC,
model delivery and relaunch after the source folder is removed, while retaining
the existing separate OS-backed storage smoke. Dialog results and model replies
are test fixtures; actual OS-dialog and paid-provider acceptance remain manual.
The initial-bundle lock rejected this increment at 803,567 bytes. Deferring rich
workspace rendering restored the unchanged 800,000-byte ceiling; chunk failure
stays within the workspace and offers an explicit reload. Five-viewport folder
review added first-line and omission-notice visibility locks and corrected the
short-window file-list height. No release signing or dependency-advisory gate is
claimed complete by this checkpoint.

The five-viewport UI review exposed a semantic coverage defect: the cell named
`thread-demo` captured a blank draft, while the `draft` cell could restore the
previous repo conversation. The sweep now must discover a populated non-repo
conversation and await its exact heading/transcript, and explicitly open a fresh
draft before measuring it. Missing subjects count as coverage failures. The
conversation check closes covering panels before capture; executable detection
tests distinguish a closed zero-width tablet dock from a live one. A duplicate
UI invariant identifier was also corrected, with a structural lock against
recurrence. On 2026-09-07, the corrected sweep passed all 135 cells across five
viewports with zero violations and zero skips; all ten corrected conversation
and draft captures were visually checked. The regression locks were watched fail
before restoration. Live account switching was also checked, and the shared
preview was returned to Ada with the six-account roster stacked.

The earlier Commons mention-help clipping refinement was resolved in the image
checkpoint described above; it is no longer an open direction or prerequisite.

One full local run of `e2e/agent-proposal-verdict.spec.ts` observed a Review
button click without its dialog remaining open. Ten focused traced walks passed;
the cause is unconfirmed, not fixed by that repetition. First-failure tracing
(`E2E_TRACE=1 npm run verify`) is now available to capture a recurrence without
adding retries or extending timeouts. Keep this observation open until evidence
identifies its cause.

A traced full run also observed the phone drawer stop accepting a session-row
click while the main pane intercepted it. Five focused walks with explicit
drawer-state assertions and the next complete run passed, but no runtime cause
or fix has been established. Keep this observation open too. The diagnostic run
separately proved that parallel Playwright processes shared trace scratch space;
each shard now owns its output directory, and the subsequent traced full run
completed without artifact collisions.

During the Word checkpoint, one full run observed the sharing-guidance node
detach during `scrollIntoViewIfNeeded`, after filling its associated note.
The failure did not capture a trace; no runtime cause or product fix is claimed.
Keep this observation open for first-failure tracing rather than masking it
with retries, a longer timeout, or an accessibility exclusion.
