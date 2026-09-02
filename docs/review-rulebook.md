# The review rulebook — exhaustive rules for mechanical review & fix

> The complete oracle catalog a **mechanical review-and-fix pass** runs against —
> function and aesthetics — so that spotting regressions never depends on a
> human noticing. It composes the repo's two earned ledgers instead of
> replacing them: [`docs/ui-invariants.md`](ui-invariants.md) (UI-1…13, each
> earned by an escape and locked at a funnel) and
> [`docs/spec/09-design-invariants.md`](spec/09-design-invariants.md)
> (INV-1…10), plus the per-feature rows in [`docs/spec/`](spec/README.md).
>
> **Two tiers, one ratchet.** The *ledgers* stay short and earned — every row
> is enforced at one funnel and locked by an enumerating test. This *rulebook*
> is the exhaustive tier: review-time oracles, each with a mechanical
> detection, that a sweep checks even though no bug has earned them a funnel
> yet. When a rulebook rule catches a real escape, it is **promoted**: named
> over all subjects, enforced at one `src/lib/` (or server) funnel, locked by
> an enumerating test, appended to the ledger — the ratchet procedure in
> `docs/ui-invariants.md`. A rulebook rule is allowed to be broad; a ledger row
> must be earned. That is how "exhaustive" and "keep the list short and
> earned" coexist.

## 0 · The mechanical process

Every review-and-fix pass runs the same five phases. Never review from memory
of what you changed — memory produces plan-shaped checklists.

1. **Enumerate.** Derive the subject set from the diff, not from the edit
   sites. Function: every route / store mutator / contract type / event the
   change can reach (grep importers transitively; a `contract/` or `src/lib/`
   change reaches everything). Aesthetics: the surface × viewport × transient
   state × content-extreme matrix (`/ui-review` §1 — the five canonical
   viewports: 320×700, 375×812, 768×1024, 844×390, 1280×800). State what you
   are NOT sweeping and why — silent truncation reads as "covered everything".
2. **Check.** Run the mechanical detectors, cheapest first:
   `npm run typecheck` → `node --test tests/*.test.ts` → `npm run build` →
   `npm run ui:sweep` (boots its own stack) → `npm run e2e` — then the per-rule
   detections below for every enumerated subject the harnesses don't model.
3. **Judge.** Screenshot each swept cell and judge the residue no rule
   expresses yet (crowding, misalignment, a control that reads as broken) — as
   a user would, not as the author who knows what's there. **Mind what the
   harnesses do NOT vary:** `ui:sweep` drives ONE account in the DEFAULT palette
   in LIGHT mode, so a palette- or mode-shaped defect is invisible to it — it
   reported 0 violations / 90 of 90 cells on the afternoon the dark-mode CTA
   was sitting at 1.74:1. Colour legibility on solid fills is no longer a
   judgment call (UI-20 made it mechanical, in `src/lib/contrast.test.ts`, across
   every palette × mode); anything else that varies by theme still needs the
   axis opened by hand.
4. **Fix.** Triage by severity (§3). Fix at the class level: if two subjects
   share the defect, unify them onto one primitive/funnel and fix there —
   never patch the one instance that was noticed (the UI-invariants ratchet
   rule). A fix ships with its test in the same change.
5. **Ratchet.** A confirmed escape becomes a ledger row (UI ledger or the spec
   pillar): statement over all subjects, funnel, enumerating lock, origin. The
   exit criterion is the row + lock existing, not the pixel/behavior being
   right once.

**Exit criteria for a pass:** all detectors green; every enumerated subject
either checked or explicitly skipped with a reason; every confirmed finding
either fixed+locked or filed with severity and repro; every promoted rule has
its ledger row.

## 1 · Function rules (F-·)

Each rule: what must hold · **Detection** (the mechanical check) · **Fix** (the
class-level procedure). Rules already funnel-locked cite their lock — for
those, detection is "run the suite".

### F-1 · The contract is the API, and it stays portable
The wire types in `contract/` are imported verbatim by both ends; they stay
framework-free, Node-free, and erasable (no enums/namespaces/parameter
properties). No UI or server code re-declares a wire shape.
**Detection:** `node --test tests/contract-boundaries.test.ts`; grep new
`interface`/`type` in `src/`+`server/` that mirror an existing contract type.
**Fix:** move the shape into `contract/`, import it on both ends (INV-8).

### F-2 · One door to the backend
UI components read through `src/api` hooks and write through commands; nothing
else knows a URL, header, or SSE event name. Documented exceptions, both
foreign-by-nature: the UI-host filesystem source (a web server can't read the
browser's disk), and the A2A card viewer's fetch of a FOREIGN instance's
agent-card URL (`src/components/SectionView.tsx`, found by this rule's first
run, 2026-07-15). The card fetch stays outside the client because the client
is origin-PINNED (`API_BASE` + path — it cannot address a foreign host, and
generalizing it to absolute URLs would erode the pin this rule checks), its
post-processing assumes OUR backend (the `x-resolved-tenant` identity-echo
tripwire, the account-generation drop, the error taxonomy — meaningless
against a foreign host), and in header-identity deployments a generalized
client would spray credentials cross-origin.
**Detection:** `node --test tests/contract-boundaries.test.ts`; grep
`fetch(`/`EventSource` outside `src/api/` — a hit is either on this exception
list or a finding.
**Fix:** add the hook/command in `src/api`, route the component through it
(INV-6) — unless the target is genuinely not our backend, in which case list
it here with the reason.

### F-3 · Every write-path absence means something, or is refused
For every NEW request field: classify its absence as **inherit**, **fixed
constant**, or **none (minimal risk)** — or refuse the request (400). Never
resolve an absence to a mutable entity or privileged value; never silently
normalize an invalid value; conveniences run at the edge and their result is
shown on the card/picker.
**Detection:** review checklist on any diff adding a request field; instance
locks in `server/routes/registry-defaults.test.ts`, `server/routes/worker-agents.test.ts`,
`server/model/model-tools.test.ts`.
**Fix:** classify or refuse (INV-9); state the resolved value on the consent
surface.

### F-4 · Tenancy is a wall, not a filter
Every new route/read is tenant-scoped (deny-foreign helpers); every emitted
event is tenant-scoped; a viewer-relative annotation (`own`, `isDefault`,
`online`) is computed at serve time, never stored, and stripped at every
mint/patch funnel.
**Detection:** `node --test server/store/event-tenancy.test.ts server/store/usage-tenancy.test.ts
server/data/demo-accounts.test.ts`; for a new route, a two-tenant test is REQUIRED
before merge.
**Fix:** scope at the store read, deny at the route, add the two-tenant lock.

### F-5 · Consent gates every model-driven mutation
A model tool call is a *proposal* — nothing applies until the user confirms;
the `tool_result` fed back says "proposed, awaiting confirmation", never
"done"; standing approvals are recorded once, per opKey.
**Detection:** `node --test server/model/model-tools.test.ts src/data/consent-state.test.ts
server/routes/relations-commons.test.ts`; grep new `executeTool` builders for a
summary that claims completion.
**Fix:** return the op/escalation as a proposal; make the summary honest.

### F-6 · New persistent state round-trips the snapshot
Every new store slice is persisted on mutation and rehydrated on boot; the
snapshot generator covers it; transient state (reservations, live registries,
relay slots) is deliberately NOT persisted and says so in a comment.
**Detection:** `node --test server/persistence/persist.test.ts server/persistence/snapshot.test.ts` (the
every-slice coverage invariant fails on an unpersisted slice).
**Fix:** extend `server/persistence/persist.ts` + the snapshot builder + the round-trip test.

### F-7 · Replays and duplicates are idempotent; async answers are entry-keyed
A re-applied create op finds its target existing and does not duplicate (the
create-project exists-check pattern; create-agent's bundled-prompt reuse). An
async completion names the entry it settles; anything else is answered
"settled or gone" (410) and can poison nothing.
**Detection:** `node --test contract/shared-reducer.test.ts server/relay.test.ts
server/routes/relations-commons.test.ts`.
**Fix:** add the exists-check at apply; key the completion to its entry.

### F-8 · Every async wait has exactly one deadline owner
A turn/poll/relay wait is governed by one named, env-tunable clock; a late
arrival meets an honest terminal answer; the slot/lock is freed on every exit
path (deadline, cancel, error) — no wedged 409s.
**Detection:** `node --test server/relay.test.ts server/routes/routes-messages.test.ts`
(deadline, late-410, slot-freed cases exist for every new wait).
**Fix:** give the new wait its own `*_TIMEOUT_MS`, race it, clear on all paths,
lock all three cases.

### F-9 · Registries have one home and live points-of-use
A registry is *managed* in one surface; every control that *offers* its entries
reads the live registry through the api hooks; no seed mirrors, no
component-state registries, no hard-coded catalogs.
**Detection:** `node --test src/api/connectivity-freshness.test.ts
src/components/model-picker.test.ts` (catalog-constant scan); grep new pickers for
list literals.
**Fix:** drive from the hook; if the concept is session-usable, give it a rail
surface (UI-12; src/CLAUDE.md "Registries have one home").

### F-10 · Every mutation has a refresh path; every event heals a reader
A server mutation invalidates a key something actually reads; an SSE case with
zero consumers is a bug; cross-tenant composed reads revalidate on mount; the
open thread reconciles through `onSessionPush`.
**Detection:** `node --test src/api/connectivity-freshness.test.ts`; for a new
event type, name its reader in the same diff.
**Fix:** wire the invalidation in `src/api/events.ts` + lock the reader (UI-12).

### F-11 · Cross-process caches degrade to resend, never to a hole
Any state cached across a process boundary (the relay connector's framing
cache, a client cache) must self-heal on either side restarting: the holder
advertises what it has, the source resends what isn't advertised, and no side
ASSUMES the other's memory.
**Detection:** `node --test server/relay.test.ts server/routes/relay-connector.test.ts`
(the reconnect-resend cases); for any new cache, a restart-both-sides test.
**Fix:** advertisement + content-address (the MODEL-21 pattern), plus the test.

### F-12 · Errors refuse loudly and fallbacks say what happened
Invalid input → 400/404/409 with a message naming the field; a degraded path
renders copy stating the actual failure ("didn't answer in time", "connector
reported an error") — never a generic success-shaped reply, never a fabricated
status.
**Detection:** route suites (`tests/routes-*.test.ts`) assert the status AND
match the message; grep new `catch` blocks that swallow into success shapes.
**Fix:** throw the typed error at the store, map at the route, show honest copy.

### F-13 · Every page has a canonical URL; every act has a principal
A new page kind extends `src/lib/urlRoutes.ts` (+ round-trip test) — no path
minted or parsed anywhere else. A new store mutation takes the acting
principal as a required parameter and stamps only the kind on the wire.
**Detection:** `node --test src/lib/url-routes.test.ts server/routes/principals.test.ts`;
grep `pushState`/`location.pathname` outside the controller.
**Fix:** extend the one mapping / thread the principal (ADAPT-15, INV-10).

### F-14 · A feature isn't done without its locks and its ledger row
Every behavior change ships tests that fail on regression (reducer/route/e2e as
the seam demands); the spec pillar gains/updates its row (statement,
implementation, lock, status); `tests/spec-conformance.test.ts` stays green.
**Detection:** `node --test tests/spec-conformance.test.ts`; diff review: a
`src/`+`server/` change with no `tests/` change is presumptively incomplete.
**Fix:** write the missing lock; add the row.

### F-15 · The mock stays honest about what it mocks
The only fake is the model server; everything around it is production-shaped.
A new capability is gated by `/capabilities` (remote → 409
`capability_unavailable`), never by silent stubbing; canned data lives in
`server/data/` seeds, never inline in components.
**Detection:** `node --test server/capabilities.test.ts` (where present) +
route suites; grep `src/components` for object-literal fixtures of server
entities.
**Fix:** move data to seeds; gate the capability; document intentional mock
behavior in spec pillar 11 (`docs/spec/11-mock-boundary.md`).

### F-16 · Dependencies stay few and deliberate
The server keeps its single dependency; UI deps are minimal; adding one
requires a stated reason in the commit.
**Detection:** `node --test tests/contract-boundaries.test.ts`; diff on
`package.json`.
**Fix:** hand-roll or justify (INV-7).

### F-17 · Concurrent edits preserve sparse intent and explicit recovery
A first-party form over server-owned mutable state sends the revision it read
and only the fields the user changed. Conflict or uncertain acknowledgement
holds that exact intent behind one visible Retry/Dismiss path; Retry reconciles
authoritative truth before rebase and keeps the logical idempotency key.
Independently moving activity is fenced or merged separately from configuration.
**Detection:** `node --test src/components/agent-mutation-ui.test.ts src/components/provider-definition-mutation-ui.test.ts src/components/system-prompt-definition-mutation-ui.test.ts src/components/commission-mutation-ui.test.ts src/api/agent-revision.test.ts src/api/provider-revision.test.ts src/api/system-prompt-revision.test.ts src/api/commission-revision.test.ts server/routes/worker-agents.test.ts server/routes/routes-providers.test.ts server/routes/system-prompts.test.ts server/routes/commission-crud.test.ts`; rendered conflict walks live in `e2e/agent-mutations.spec.ts`, `e2e/provider-definition-mutations.spec.ts`, `e2e/system-prompt-definition-mutations.spec.ts`, and `e2e/commission-mutations.spec.ts`.
**Fix:** add a server-owned domain revision, compare-and-swap route, monotonic
cache merge, sparse frozen patch, and shared acknowledgement controller before
shipping the editor.

### F-18 · Creation is one durable logical act
A first-party create form retains its complete submitted payload until server
truth settles it. Retry reuses one account-scoped key whose opaque durable row
identity survives response-cache loss; reconciliation proves that exact identity,
never mutable labels, bodies, timestamps, or an arbitrary new collection row.
**Detection:** `node --test src/components/agent-creation-mutation-ui.test.ts src/components/system-prompt-creation-mutation-ui.test.ts src/api/agent-creation-identity.test.ts src/api/system-prompt-creation-identity.test.ts server/agentCreationIdentity.test.ts server/systemPromptCreationIdentity.test.ts server/routes/worker-agents.test.ts server/routes/system-prompts.test.ts`; rendered failure and lost-response walks live in `e2e/agent-creation.spec.ts` and `e2e/system-prompt-creation.spec.ts`.
**Fix:** route the form through the acknowledged-action FIFO, derive a tenant-
scoped persisted identity from its stable key, return represented truth before
parsing Retry input, and close the form only on applied or reconciled truth.

## 2 · Aesthetic rules (A-·)

The earned UI ledger (UI-1…13) is the hard floor — run its locks first. These
rules are the exhaustive rubric above it. "**Judgment**" detection = the
screenshot pass of `/ui-review` §3; everything else is a scan or harness check.

### A-1 · Layout integrity at every cell
No horizontal scroll (UI-2); no element painting over a sibling; no zero-width
identity column (UI-7/UI-9); every popover fully in-viewport (UI-1); covered
content inert (UI-8).
**Detection:** `npm run ui:sweep` + `npm run e2e` (responsive spec); judgment
for overlap the harness can't name.
**Fix:** the owning funnel (popover/viewport/hoverReveal/container-query);
ratchet a new class into the ledger.

### A-2 · Color comes from the theme's tokens
UI chrome uses the token palette (`ink`/`panel`/`surface`/`line`/`accent`/
`cap-*`, the semantic `removed`/`added` pair, and the status ramps
`ok`/`warn`/`danger` + `on-solid`); raw hex/rgb is legitimate only in
data-visualization and image-fallback contexts (today: `UsageControl`,
`CodePanel`'s terminal block, `AddContextButton`'s traffic lights,
`HostsControl`). Both themes come from the same tokens — dark is the
`[data-theme="dark"]` variable block in `src/index.css`; no `dark:` variants,
no raw chromatic palette classes (INV-1).
**Detection:** `rg '#[0-9a-fA-F]{3,8}' src/` — any file OUTSIDE the known
data-viz set is a finding; `tests/spec-conformance.test.ts` (INV-1: dark-scan,
palette-scan, dark-block completeness).
**Fix:** swap to the nearest token; if no token fits, add one to the theme —
never a one-off literal.

### A-3 · One primitive per role — same role, same look
Every control doing an established job routes through its primitive:
add-triggers (`AddTrigger`), fold headers (`foldHeader`), scrims (`scrim.ts`),
popover chrome (`popover.ts`), dismissal (`useDismissable`), copy buttons
(`CopyButton`), spinners (`Spinner`), resize dividers (`ResizeHandle`), pane
chrome (`paneChrome.ts`), bylines/credit (`PublicFace`), checkboxes
(`checkbox.ts`). A new control that visually parallels an existing one either
uses the primitive or unifies both onto a new one.
**Detection:** the primitive suites (`src/lib/addTrigger.test.ts`,
`src/lib/foldHeader.test.ts`, `src/lib/scrim.test.ts`, `src/lib/popover.test.ts`,
`src/lib/copy-button.test.ts`, `src/lib/spinner.test.ts`,
`src/lib/useDismissable.test.ts`, `src/components/resize-handle.test.ts`,
`src/lib/public-face.test.ts`, `src/lib/checkbox.test.ts`); judgment: two
lookalikes rendered differently.
**Fix:** extract/adopt the shared primitive + enumerating lock (INV-4/5).

### A-4 · Motion is bounded and optional
No infinite animation outside the `motion-safe:`-gated spinner funnel (the
bare `animate-*` scan); entrance/exit transitions stay ≤ ~300ms; a keyboard
gesture is never animated slower than its pointer twin; `prefers-reduced-motion`
is respected wherever motion exists.
**Detection:** `node --test src/lib/spinner.test.ts` (the bare-animate scan);
judgment for duration/jank; `e2e/keyboard-resize.spec.ts` for the keyboard path.
**Fix:** gate or bound the animation at the funnel.

### A-5 · Keyboard and screen-reader parity
Everything drag-operable is keyboard-operable with announced values (UI-11);
every interactive element is reachable, has a distinct accessible name, and
shows the app-wide focus-visible ring; landmarks stay unique; a persistent
resource rail has a first-in-order bypass to main; each addressed resource has
heading identity; form fields keep names independent of placeholder copy;
icon-only buttons carry `title`/`aria-label`.
**Detection:** `npm run e2e` (`accessibility-audit`, accessibility-navigation,
keyboard-resize, responsive); the automated lane runs exclusion-free WCAG 2.2
AA checks across core wide/narrow pages and creation dialogs. Then sweep: start
from the address bar and tab into each new surface; inspect its heading outline
and field names; scan changed components for button names and triage
text-content buttons by hand.
**Fix:** name/wire at the primitive; add the e2e press-path.

### A-6 · Responsiveness follows the tier ladder and the container
Wide/medium/narrow behaviors per ADAPT-11; content inside a resizable
container gates on `@container`, not viewport (UI-9); viewport units are
`dvh` (UI-6); chrome is in-flow on narrow (UI-3); hover-revealed affordances
resolve the narrow tier (UI-7); tiling (the split frame) exists only where
the tier has room (ADAPT-16).
**Detection:** `node --test src/lib/viewport.test.ts src/lib/hoverReveal.test.ts`;
`npm run ui:sweep` across the five viewports; `npm run e2e`.
**Fix:** at the tier owner (`viewport.ts`, the shell) — never per-component
window listeners.

### A-7 · Text truncates or wraps — never clips, overlaps, or lies
Identity text (names, titles) gets `truncate` + full value on `title` (or
wraps); fixed metadata yields before identity does; number/date formats are
consistent (`relativeTime` for recency); the longest seeded content is part of
every sweep.
**Detection:** sweep with content extremes (§0.1); judgment on screenshots.
**Fix:** `min-w-0` + `truncate` at the row primitive; demote metadata via
container queries.

### A-8 · Every surface has honest empty, loading, and failure states
A list renders a designed empty state (not blank space); async surfaces show
the shared spinner or an explicit waiting line ("Waiting on your session…");
failures render the F-12 copy. No state is represented by nothing.
**Detection:** sweep each new surface with an empty store
(`npm run snapshot:restore` of a clean snapshot) and with the server stopped;
judgment.
**Fix:** add the state; reuse the established empty-state pattern of the
sibling sections.

### A-9 · Type and spacing come from the de-facto scale
Text sizes from the established ladder (11/12/13/sm/base semantics — the
`text-[11px]`/`text-[12px]`/`text-sm` family already in use); icon sizes from
the established set (13/15/16/18 via lucide `size=`); gaps/padding from the
Tailwind step scale already present (1.5/2/2.5/3…). A NEW magnitude is a
design decision, not a convenience.
**Detection:** diff scan: any `text-[`/`size={`/`gap-[` value not already used
in the codebase (`rg "text-\[[0-9]+px\]" src | sort -u` as the census);
judgment for rhythm.
**Fix:** snap to the nearest existing step; if genuinely new, use it
consistently and note it here.

### A-10 · Compound cues are self-contained; density is deliberate
A multi-part primitive carries its own layout container (UI-13); related
controls cluster with consistent gaps; nothing renders butted-together; cards
and rows keep the section's established padding.
**Detection:** `node --test src/lib/public-face.test.ts` (the UI-13 lock);
judgment.
**Fix:** root the layout in the primitive, not the caller.

### A-11 · State cues are truthful
A status dot/badge/pill renders only server-asserted state (the fabricated
green dot class, UI-12); a disabled control explains itself (`title`); a
consent card states exactly what confirming will do (the resolved provider /
prompt / grant / role — INV-9's "show the result" edge).
**Detection:** `node --test src/api/connectivity-freshness.test.ts
src/data/consent-state.test.ts`; judgment: any cue with no live source.
**Fix:** bind the cue to the live registry or remove it.

### A-12 · Ownership and identity render through one face
Owner-only controls never render for visitors; bylines/credit come from
`publicFace` (UI-10); agent actors wear the badge, not a door (INV-10).
**Detection:** `node --test src/lib/public-face.test.ts`;
`npm run e2e` (co-author spec); two-account sweep for any new shared surface.
**Fix:** gate on the projection's `own`; route cues through the funnel.

### A-13 · Copy is honest, sentence-cased, and consistent
Buttons/labels use sentence case ("Split right", "Add context"); proposals say
"awaiting confirmation"; degraded states name the cause; the same concept uses
the same word everywhere (a "routine" is never also a "task" in UI copy).
**Detection:** judgment + `rg` for the concept's synonyms when renaming;
existing copy locks in component tests.
**Fix:** align to the dominant term; update all sites in one pass.

### A-14 · Transient surfaces behave like citizens
Every popover/menu/dialog dismisses on outside-click + Escape (UI-5/INV-5);
opens within the viewport (UI-1); traps focus if modal; restores focus on
close; never stacks two scrims of different darkness (UI-4).
**Detection:** `node --test src/lib/useDismissable.test.ts src/lib/scrim.test.ts
src/lib/popover.test.ts`; sweep: open every new transient surface at 320×700
and 844×390.
**Fix:** the owning funnel.

## 3 · Severity & fix policy

| Sev | Class | Examples | Policy |
|-----|-------|----------|--------|
| S1 | Consent bypass · tenancy leak · data loss | a model mutation applying unconfirmed; a foreign tenant's row served; a store slice dropped on restart | Fix before anything else ships; regression test mandatory; ledger row mandatory. |
| S2 | Functional break | a route 500s; an event heals nothing; a wedged slot | Fix in the same pass; lock at the seam it broke. |
| S3 | Accessibility violation | keyboard-unreachable control; missing separator values; non-inert covered content | Fix in the same pass (WCAG rules are requirements, not polish); e2e press-path lock. |
| S4 | Aesthetic defect | truncation, overlap, crowding, off-token color, missing empty state | Fix at the primitive; promote to a ledger row if it escaped to a user. |
| S5 | Taste | "feels heavy", spacing preference with no rule | Report only — never invent a rule nobody's bug earned. |

## 4 · Keeping the rulebook itself mechanical

`tests/review-rulebook.test.ts` locks this document's structure: rule IDs are
unique and sequential per tier, every rule carries a **Detection** and a
**Fix**, and every backticked repo path it cites exists — so the rulebook
can't rot into wishful prose. When a rule is promoted to a ledger row, keep
the rulebook rule and add the lock citation; when a rule proves un-checkable
in practice, rewrite its detection or demote it to the S5 rubric — a rule
without a detection is a hope, not a rule.
