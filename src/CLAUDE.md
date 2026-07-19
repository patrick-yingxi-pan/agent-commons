# src/ — UI rules (loaded when working under src/)

Scoped context for the UI layer. The always-on map is [`AGENTS.md`](../AGENTS.md);
this file holds the locked design decisions that govern `src/` code. Each rule
names its locking test — moving or weakening a rule means moving its lock too.

## Ground rules

- **One door to the backend.** UI components read through hooks (`src/api`);
  controllers issue commands. Nothing else should know a URL or an SSE event.
- **Light theme only.** There is no dark mode — no `dark:` variants and no theme
  toggle. Don't add one unless the proposal direction changes.
- **No "before" view.** The prototype deliberately does *not* reproduce today's
  three-tab UI. The motivation lives in the docs, and reviewers can diff against
  the live app — so don't build a side-by-side "before".
- **Minimal runtime dependencies.** The UI's deps are deliberately minimal;
  don't add one without good reason.

## Form follows function — parallel controls share one styled primitive

Logically / structurally similar elements must *look* the same: same role ⇒ same
look, so the UI reads as one system and the cue can't drift between copy-pasted
copies. When you find two controls doing the same job rendered differently, unify
them onto a single shared component/token rather than hand-restyling one to match.
Embodied by `src/lib/inlineAction.ts` + `src/components/AddTrigger.tsx` (every
"+ Add ‹thing›" picker-opener) and `src/lib/sectionAction.ts` +
`src/components/SectionAction.tsx` (every SECTION HEADER's verb — edit/add/post/
commission — one compact icon button in the header's right-aligned cluster,
hover-revealed via `SECTION_REVEAL` in `src/lib/hoverReveal.ts`, pinned visible
when the section is empty; locked by `tests/sectionAction.test.ts`) and
`src/lib/foldHeader.ts` (every foldable section
header) and `src/lib/pageHeader.ts` (every PAGE's opening title block — hub and
detail pages share one title look + container rhythm; the chrome bars
`SessionTitleBar`/`PanelShell` are a different role, deliberately distinct)
and `src/lib/scrim.ts` (every dimmed overlay backdrop — the tier scrims and
the dialog scrims alike) and `src/lib/popover.ts` (every anchored popover surface —
chrome + the stay-inside-the-viewport containment, applied by
`src/lib/usePopoverShift.ts` / `clampLeft`) and `src/lib/copyButton.ts` +
`src/components/CopyButton.tsx` (every copy-to-clipboard button — the rendezvous-secret
reveal and the A2A-card viewer alike, label swapping to "Copied" then self-resetting)
and `src/lib/spinner.ts` + `src/components/Spinner.tsx` (every loading spinner — its
spin gated behind `motion-safe:` so it respects `prefers-reduced-motion`, WCAG 2.3.3;
the lock forbids ANY bare `animate-{spin,pulse,ping,bounce}` so no infinite animation
ships ungated — which also keeps a headless screenshot from chasing an animation that
never settles);
each shared cue is locked by a test
that fails if a component re-hardcodes it (`tests/addTrigger.test.ts`,
`tests/foldHeader.test.ts`, `tests/pageHeader.test.ts`, `tests/scrim.test.ts`,
`tests/popover.test.ts`, `tests/copy-button.test.ts`, `tests/spinner.test.ts`).
The same rule governs
shared *behaviour*, not just styling: every popover / dropdown / menu dismisses on
outside-click + Escape through one hook, `src/lib/useDismissable.ts` (locked by
`tests/useDismissable.test.ts`, which fails if a component re-hardcodes the document
`mousedown` listener). Add new shared tokens / hooks the same way — one source of
truth, asserted by a test. The primitives double as **enumeration handles for
review**: because every subject routes through one funnel, a single scan (or a
`data-*` stamp, e.g. `data-popover`) can visit all of them — see
[`docs/ui-invariants.md`](../docs/ui-invariants.md), the earned ledger of
machine-checkable UI rules behind the `/ui-review` skill
(`.claude/skills/ui-review/SKILL.md`). After a UI change, review against that
ledger — sweep the surfaces × viewports the *diff* could affect, not the spots
you edited — and ratchet every confirmed escape into a new funnel + lock + row.
The **exhaustive** oracle catalog above the earned ledger — function (F-·) and
aesthetic (A-·) rules, each with a mechanical detection + fix procedure, the
severity policy, and the five-phase review-and-fix process — is
[`docs/review-rulebook.md`](../docs/review-rulebook.md) (structure locked by
`tests/review-rulebook.test.ts`); rulebook rules promote into the earned
ledgers when an escape confirms them.

## Registries have one home and live points-of-use

Every account-level registry
(Model providers → the **Models** rail section; worker agents / prompts /
commissions → the **Agents** hub; saved connectors & repos → **Contexts**) is
*managed* in exactly one surface, and every control that *offers* its entries —
the composer's model selector, a routine's model picker, Customize's default
model, the Agent dialog's provider picker — reads the **same live registry
through the api hooks**, never a hard-coded mirror. (The composer's model list
was once a frozen trio while providers lived in a hub tab — registering a model
didn't make it selectable; that class of drift is the target.) Embodied by
`src/components/ModelPickerMenu.tsx` (the one provider→model→effort menu, all
three pickers) and locked by `tests/model-picker.test.ts`, which fails if ANY
src/ file declares a model/effort catalog constant: the models a picker lists
are each provider's **own catalog** (`ModelProvider.models` — fetched from its
endpoint's `GET /v1/models` or declared at registration, spec MODEL-16/-17), so
even the default Claude models are registry rows, and the composer strip's
usage gauge measures against the resolved model's provider-sourced context
window (honest unknown-capacity when it doesn't expose one).
When adding a picker for a registry concept,
drive it from the registry hook and route it through the shared menu — and if the
concept's entries are usable in sessions, make the registry a first-class rail
surface, not a sub-tab of the thing that consumes it. A registry entry can be
flagged the caller's **default** (`isDefault`, set via the one shared
`DefaultToggle` in the entry's own dialog) — a pure UI pre-selection shortcut
(spec MODEL-15), governed by invariant **INV-9** (*strict core, convenient edge*:
an absent request field must mean something fixed, or be refused — full statement
in [`docs/spec/09-design-invariants.md`](../docs/spec/09-design-invariants.md)).
The rule's general form is
invariant **UI-12** (`docs/ui-invariants.md`): every displayed datum reads a LIVE
source and has a SYNC path — no seed-mirror reads (the rail's project menus once
missed every runtime-created project), no SSE case that invalidates a key nothing
reads, no component-state "registry" that evaporates on unmount (the Contexts
page's add/remove once did), no asserted status a registry actually owns (the
composer quick list's fabricated green dot). Locked by
`tests/connectivity-freshness.test.ts` + `tests/event-tenancy.test.ts` (the
2026-07 connectivity audit's ratchet).

## Rail navigation is an inline disclosure tree

Sections render as a VSCode-explorer
tree (spec ADAPT-13): a section with sub-nodes carries a chevron and expands **in place**
— children indented below it, siblings staying put, **no push and no back button**. (The
earlier drill-in *replaced* the section list with a pushed sub-menu behind a "‹ Sections"
chip + a height-reservation hack; the odd post-click view that produced is exactly what
the tree fixes — a rail that reflows or navigates-away on expand is the bug.) The chevron
toggles children without navigating; the row body opens the page. It's driven by ONE
registry — `src/lib/subviews.ts` (`SECTION_SUBVIEWS`) — read by **both** the rail
(`Sidebar`, `SectionTreeRow`) and the body (`SectionView`), so they can't drift (the
*Registries have one home* rule). Two node kinds, by nature: **content sections**
(Contexts / Artifacts / Scheduled / Models / Projects) expand to their **facet groups**
(kind / type / status / provider-class / ownership) — clicking a group focuses the page
on it, the section row shows all groups; the **Agents hub** expands to its four
*non-default surfaces* (Prompts / Commissions / Discover / Audit) — the section row
itself is the worker-agents surface, so it isn't re-listed as a child (that would
duplicate "Agents" and make the nav ambiguous). A section lands on its **default** view
(rail sub-view `null`; each body maps null to its own default). A facet is chosen in
**one** place — the tree — never *also* an in-page filter bar; a section's grouping and
its rail children are the same partition, so don't add an in-page tab/dropdown that
re-selects it. When a section grows a new facet, add its group nodes here — the body
filters on the same `subview` the tree selects. Locked by `tests/section-subviews.test.ts`
(inline tree not a push; child ids = the body's switch keys; grouping in the tree, no
in-page filter bar). A **Sections** header carries one **fold/unfold-all** toggle. The
rail's lower body is an **accordion of foldable, resizable panes** — Sections, Scheduled,
Recents. Each pane's header has a **fold caret** (symmetric across all three); folding
collapses it to its header (persisted per pane). Open panes hold a **persisted, FIXED**
height except the **top-most open one**, which **flexes** to fill — Sections is the pane
with the most rows, so it takes every spare pixel, and folding Scheduled/Recents drops
their headers **downward** while handing the space to Sections (folding never opens a
gap; fold Sections and Scheduled flexes instead). A
divider moves only on drag — folding or a content change never moves it (**fixed unless
manually adjusted**); heights **clamp at render, never in storage** (the rule the rail
*width* follows, `useLayout`). A drag rewrites **only the dragged pane's** stored height,
computed from the OTHER panes' **effective** heights, so the clamp can't leak into an
untouched pane's stored value (a real bug an earlier sum-preserving model had). The pure
allocation/drag math (`layoutPanes` / `dragPane`) lives in `src/lib/railPanes.ts`
(dependency-free, node-tested); dividers are **in-flow gutters between panes** (never
overlaying a pane's scroll content/scrollbar), each riding **above** the fixed pane it
resizes (drag/arrow **up grows** it; the flex pane absorbs), reusing the ONE
`ResizeHandle` primitive
(`top`/`bottom` orientation, with a persistent hairline on horizontals — form follows
function). Every `ResizeHandle` — rail width, panel width, pane gutters — is
**keyboard-operable** (WCAG 2.1.1, invariant UI-11): a focusable, distinctly named
separator whose axis arrows run the same start→move→end pipeline as a pointer drag,
announcing its size + bounds (`aria-valuenow/-min/-max`, WCAG 4.1.2) from the same
constants the clamp enforces.
Dividers **drop on the narrow tier** (`resizable` false → panes flow in the
drawer, ADAPT-11; folding still works). Two **labeled** `<nav>` landmarks keep the rail
landmark-unique (WCAG) *and* section rows navigation-scoped for e2e — "Create" (New
session) and "Sections" (the tree) — while Scheduled/Recents stay out of navigation.
Locked by `tests/rail-panes.test.ts` (fold combos + flex promotion, fit-to-avail clamp,
min floors both drag directions, no clamp-leak into storage) and
`tests/resize-handle.test.ts` + `e2e/keyboard-resize.spec.ts` (the keyboard path).

## Every page has a canonical URL — the address bar projects the nav model

GitHub's navigation rule (a link is the coordination primitive:
shareable, bookmarkable, open-in-new-tab-able) applied to this shell:
`src/lib/urlRoutes.ts` is the ONE pure two-way mapping (NavLocation + sub-view ↔
path — `/s/:id`, `/:section[/:subview]`, `/projects/:id`, `/scheduled/:id`,
`/u/:name`; a registered sub-view id is a reserved word beating a detail id), and
the controller owns the History sync: pushState mirrors every navigation
(equality-guarded), popstate applies browser Back/Forward (page + sub-view,
parallel to — never recorded in — the in-app back stack), and the **boot address
is consumed once per page load, winning over per-account view memory** (a pasted
link opens what it names; an account switch restores memory and rewrites the
address). Transient focus (a highlighted item / comment) is not page identity and
stays out of the URL. When adding a page kind, extend the mapping + its
round-trip test — never parse or mint a path anywhere else. Locked by
`tests/url-routes.test.ts`; spec row ADAPT-15. Companion rule — **titles are
doors**: a card / list row fronting a page makes its TITLE the primary click
target (GitHub's title-as-link), wired to the same handler as the explicit open
affordance (`CommonsCardHead`'s `onOpen`; the work-item title opens its thread).

## The back-history rule — an in-page door carries its origin; browser Back is per-page

(Owner directive 2026-07-17, spec ADAPT-18.) Every page opened by
clicking WITHIN a page carries a back affordance to the page that opened it —
across section boundaries and across the page↔conversation line (a session row
opens a conversation whose title bar leads with back; a breadcrumb opens a
project page whose back names the conversation). Mechanism: the pane's content
carries a `back` stack of `PaneLoc`s (`src/lib/paneHistory.ts` is the model;
`PaneBody` in `MainSplit.tsx` is the ONE push funnel for pane-originated doors);
chrome doors (rail / palette / notifications) RESET the stack — top-level
navigation starts fresh, GitHub's top-nav rule. The affordance is the one
`BackButton` (`src/components/BackButton.tsx`) on detail pages, hub `PageHeader`s
(when history exists), and the `SessionTitleBar`. Browser Back/Forward apply
per page too (`planPop`): pop the focused pane's own back top, else REFOCUS the
pane already showing the address (never clobber with a duplicate), else plain
route. When adding a door, decide which side of the page/chrome line it's on —
in-page doors must route through the pane funnel (or a push-flagged shell door),
never bare `routeToFocused`. Locked by `tests/pane-history.test.ts` +
`e2e/back-history.spec.ts`.

## The entity page is the shared surface — capability shapes affordances, not location

A shared Project (and any future shared entity) has ONE canonical page
serving owner and visitor alike, GitHub-repo-style: what differs is which controls
exist (the projection's viewer-relative `own` flag is the gate), never where you go.
Directory cards (Discover) are *doors* into those pages, not parallel leaf surfaces;
ownership cues (byline, credit, shared marker) come from one primitive
(`src/lib/publicFace.ts` + `src/components/PublicFace.tsx`, invariant UI-10, spec
COMMONS-13). Don't add a visitor-variant page or an owner-only rendering of the same
entity — gate affordances on `own` inside the one page.

## Surface follows the entity's nature

Before choosing a control or layout, ask
what the thing *is* — its temporal nature (moment / state / **lifecycle**), its
payload (a **change** → a diff; prose; refs; a quantity), the interactions it
accumulates (a **thread**; a **negotiation** with a verdict), and its **relations**
(ref links + back-references) — and let that dictate the form. A lifecycle entity
wants a **dedicated page with a timeline** (state transitions + thread interleaved),
not a modal; a change wants a **diff**; a relation wants a **ref link**. A modal is
only for a transient act. This is the deep form of "form follows function"; the full
method + the living refinement audit are in
[`docs/design/surface-from-nature.md`](../docs/design/surface-from-nature.md) and
[`docs/design/surface-audit.md`](../docs/design/surface-audit.md). New timeline / diff /
ref-link forms become shared primitives the first time two entities need them.

## The universal split workspace (the equal-pages model — LANDED, phases 1–8)

The owner's locked end state: *"every page is equally displayed in the main
background and supports the same functionality: split in two directions and
close; when the last page is closed, only the background is displayed."* The
split tree is the ONLY render path — no privileged pane kind: conversations
(the fresh DRAFT included, through the shared draft funnel `draftCore.ts`),
section pages, and context panels are equal store-backed panes; a `null` tree
is the BACKGROUND, repopulated by the rail's doors. Every navigation lands in
the FOCUSED pane, and **the address bar projects the focused pane**. Wide tiles
the tree; the overlay tiers render the focused pane alone with the
`OverlayPanelDock` docked panel (ADAPT-11). `useSessionWorkspace.ts` is only
the SHELL's nav controller; conversations live in `usePaneConversation` +
`ConversationPane`, context mutations in `useSessionContextCommands`, and the
per-account view memory IS the persisted split tree. Deleting a session evicts
every pane it hosts on every client (`session.removed` is the definitive
gone-signal); a pinned context pane whose subject was detached self-collapses
once server-reconciled. The full architecture, phase ledger, and generalized
LESSONS live in
[`docs/design/universal-split-workspace.md`](../docs/design/universal-split-workspace.md)
— **consult it before touching `useSessionWorkspace.ts`, the split libs, or the
panel components**, and land work as its phases, each with tests.
