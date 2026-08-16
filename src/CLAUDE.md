# src/ — UI rules (loaded when working under src/)

Scoped context for the UI layer. The always-on map is [`AGENTS.md`](../AGENTS.md);
this file holds the locked design decisions that govern `src/` code. Each rule
names its locking test — moving or weakening a rule means moving its lock too.

## Layout — a module carries its own context and locks

| Module | What it owns |
|---|---|
| [`lib/`](lib/CLAUDE.md) | shared primitives, the registries, the pure derivations |
| [`components/`](components/CLAUDE.md) | every rendered surface |
| [`api/`](api/CLAUDE.md) | the one door to the backend (cache, events, hooks) |
| [`controller/`](controller/CLAUDE.md) | the command side of that door |
| [`data/`](data/CLAUDE.md) | client-side derivations (the funnel, card states) |

Suites sit beside what they lock, as `<subject>.test.ts`, and are excluded from
`tsconfig.json` so colocation doesn't silently start typechecking the test
surface ([`tests/CLAUDE.md`](../tests/CLAUDE.md) measured that cost).

**What a colocated UI suite can prove is limited, and the limit shapes where
code goes.** `node --test` has no DOM: a suite next to a `.tsx` file can only
scan its source. So pure logic belongs in [`lib/`](lib/CLAUDE.md) where it is
locked exactly, browser facts belong in [`e2e/`](../e2e/CLAUDE.md), and what
neither can reach is verified in the running app **and said so**. A rule that is
awkward to assert is usually a rule whose logic wants to move.

## Ground rules

- **One door to the backend.** UI components read through hooks (`src/api`);
  controllers issue commands. Nothing else should know a URL or an SSE event.
- **Theming through tokens.** Appearance is two axes — Light / Dark / System
  AND a color palette (Claret default · Terracotta · Indigo · Forest) — set in
  Customize, persisted + applied by the ONE funnel `src/lib/theme.ts` (it alone
  stamps `data-theme` and `data-palette` on `<html>`; "system" follows
  `prefers-color-scheme` live). A palette is a CSS block pair in `index.css`
  overriding EXACTLY the `PALETTE_TOKENS` set (neutrals + accent family +
  userbubble) in both modes — semantic ramps are palette-invariant, and the
  picker derives from the `PALETTES` registry, never a hand list (locked by
  `src/lib/theme.test.ts` + the per-palette completeness scan in
  `tests/spec-conformance.test.ts`). Every color is a `@theme` token in `src/index.css` and dark is a
  single variable-override block there, so components carry **no `dark:`
  variants and no raw Tailwind palette classes** — status cues use the semantic
  `ok`/`warn`/`danger` ramps, text atop solid fills uses `on-solid`. Locked by
  `tests/spec-conformance.test.ts` (INV-1) + `src/lib/theme.test.ts`. (This
  overturns the earlier light-only decision — owner directive, 2026-07-21.)
- **Flat ledger style, Claret palette** (owner directive 2026-07-31). The visual
  direction is GitHub-Primer-flat on the Claret palette (oxblood accent on
  rose-cast linen neutrals — every neutral biased toward the accent's hue, the
  2026-08-03 harmonization; canvas and surface share one value — boundaries are
  hairlines and spacing, not fill contrast). Containment is semantic: a COLLECTION renders as
  **hairline-divided rows with NO frame** when its items are navigation
  synopses (Projects, Agents, Models, directories, work queues, runs and
  `CardList` — `ResourcePageSynopsisRow` + `LEDGER_LIST_CLASS`), or a stack/grid
  of QUIET CARDS when each item carries a rich or independently functional body
  (a feed post, editor, diff or metric tile) — both recipes live in
  `src/lib/ledger.ts`. A compact detail page is not a rich body: configuration,
  history and primary lifecycle acts begin on the canonical resource page.
  **The structure
  a collection used to draw around itself lives on its SECTION TITLE now**
  (owner directive 2026-08-12: *"remove boxes for items in sections, they are
  visual noise; make section titles and boundaries more clear"*) — one rule
  under the heading (`LEDGER_RULE_CLASS`, `border-line-strong`) instead of four
  sides around each list, with the label at `ink-soft` since it is now
  load-bearing rather than merely naming a box. The rule outranks the row
  dividers (`line`) ON PURPOSE: equal hairlines made a page of eight sections
  and thirty rows read as thirty-eight equal strokes, which is quieter than the
  boxes and less legible — half of what was asked for, and the wrong half. An
  empty section is one quiet line, not a dashed frame: it was the louder defect
  of the two, at 39 call sites against 17, drawing a bigger shape to say that
  nothing is there. Radius
  scale: CONTROLS 6px (`rounded-md` — buttons via
  `src/lib/button.ts`'s one solid/danger face and the bordered secondaries,
  fields via `src/lib/formInput.ts`), cards and hover-row fills 8px,
  standalone objects and dialogs 12px. An interactive
  object standing alone (the composer, a diff, a proposal card, dialogs) keeps
  its own chrome, and ELEVATION means floating: exactly four overlay surfaces
  cast shadows (`lib/popover`, `lib/dialog` — the one dialog-surface funnel —
  `Tooltip`, `AccountMenu`). All of it ratcheted by `src/lib/ledger.test.ts`
  (recipes flat, no hand-rolled bordered divider containers, no resting shadow
  of any spelling tree-wide, overlay allowlist alive-checked). The claret accent neighbors the danger reds: solid
  claret means "go", bright signal-red means "danger", never both weights on one
  surface. This restyles but does not restructure — the rail, the split
  workspace, and every navigation rule below are unchanged.
- **The rail is FLUSH** (owner directive 2026-08-10). `--color-sidebar` is
  `var(--color-canvas)` in every palette and mode — a reference, not a copied
  hex, so the two can never drift and a palette wanting a distinct rail
  overrides it with a literal. The left panel has no fill of its own; the
  hairline and spacing carry the boundary, which is the flat-ledger rule applied
  to the one surface still exempt from it. It replaced a rail derived as *canvas
  darkened ~2% and nudged toward the accent hue* — a formula, run identically in
  all four palettes, that could only ever produce a slightly dirty white
  (owner: *"slightly oriented to the theme color, which is poor taste"*).
  **The consequence to remember:** a rail cue can no longer be painted in
  `surface`, because surface IS the rail now — `SIDEBAR_HOVER` and the active
  row moved to `panel-2`, the neutral one STEP off the canvas (darker in light,
  *lighter* in dark — the cue promises separation from the ground, never a
  direction; "it darkens" is true of half the matrix and wrong about the rest).
  The fold-header lock that had forbidden unifying the rail and page hovers was
  inverted with the rule it guarded: one ground, one cue
  (`src/lib/foldHeader.test.ts`). Contrast's token resolver follows
  `var()` references so a token may be written as one (`src/lib/contrast.test.ts`).
- **The Bindery duet + the seat law** (owner directive 2026-08-03, place clause
  revised 2026-08-10). The default palette is a TWO-color system: claret VERBS
  against a Prussian-blue RESPONSE voice (`--color-co(-strong/-tint)`) — it read
  "against Prussian-blue PLACES" until the rail showed what that cost. The
  accent family owns what you can do — the
  CTA tier (**auth Sign in alone** — the only true solid left; the rail's New
  session left the tier 2026-08-10, owner directive: *"we don't need such a showy
  color for new session — spare the color for more important scenarios"*. A
  solid slab across the top of a panel whose every other row is quiet text spent
  the system's loudest ink on NAVIGATION, leaving nothing louder for the acts
  inside the workspace that actually commit something. New session is a rail ROW
  now, findable by POSITION and a ringed glyph, with the accent surviving as the
  icon alone. Locked as an ABSENCE — `src/lib/button.test.ts` fails if any solid
  returns to `Sidebar.tsx`), the SOFT verbs
  (`SOFT_BUTTON_CLASS`, tinted fill), the secondary's hover answer, danger
  solids. The co family owns the system's TRANSIENT ANSWER to you — the focus
  flash on arrival, field focus (`focus:border-co`), selection states, checked
  checkboxes, the keyboard focus ring, title-door hovers, the user bubble.
  **Standing location is NOT co** (owner directive 2026-08-10, revising the
  original "places wear co"): the rail's active row is a neutral fill plus a
  weight bump (`SIDEBAR_ACTIVE`), because a blue pill made a NAVIGATION marker
  the loudest thing in the panel that had just given up its solid to stop
  shouting — and three of the four palettes are single-voice anyway, so the
  duet was never load-bearing. The sharper line: co means *the system just
  responded*; weight and fill mean *you are here*. One active look serves every
  rail row kind (the section pill and the session rows had drifted into two).
  Locked by `src/lib/sidebar.test.ts`. Verbs never
  wear co, places never wear accent (locked by `src/lib/button.test.ts` +
  `src/lib/form-input.test.ts`); single-voice palettes set co = accent and are
  unchanged. The six capability-chip hues are the EMBELLISHMENT layer — famous-
  card pigments (Schönbrunner/Prussian/Burgundy/Marrs/Klein/Titian) at tint
  weight, palette-invariant, never a third voice.
- **The solid-fill seat** (invariant UI-20). A colour that is READ and a colour
  that is FILLED UNDER TEXT are different jobs — and in dark mode they pull
  apart, because the accent is lightened to be readable on a dark ground, which
  is what makes it unable to carry white. So a fill under `text-on-solid` wears
  its own token, `--color-*-solid(-strong)`; `--color-accent` / `*-strong` stay
  the text/dot/bar voice. Every solid seat clears 4.5:1 against `on-solid` in
  all four palettes × both modes, and the text seat is separately held to 3:1
  against the canvas so the two can't be collapsed back together. **Never pair
  `text-on-solid` with `bg-accent` / `bg-co` / `bg-danger` / `bg-*-strong`** —
  the dark-mode CTA shipped at 1.74:1 that way. Locked by
  `src/lib/contrast.test.ts` (the whole palette × mode × seat matrix, plus a
  tree-wide call-site scan); the image-backdrop exemptions are enumerated there.
- **The type scale is CLOSED** (owner directive 2026-08-13: *"reduce the number
  of font sizes, types and styles"*; invariant UI-27). Seven sizes — 10 meta-caps
  · 11 meta · 12 label · 13 body · 15 reading · 20 title · 24 display — three
  weights, four leadings, three families, and ONE relative size (inline code, a
  ratio of its host). Declared in `src/lib/typeScale.ts` and enforced by
  `src/lib/type-scale.test.ts`, which scans the whole of `src/` and fails on any
  utility outside the set; the one exempt file (`artifactPreview.tsx`, which
  renders a MINIATURE of a document and so uses the document's ladder, not the
  UI's) is named there with its argument. It replaced **fourteen** sizes, five of
  them inside a four-pixel band, two spellings of one size, and single-call-site
  strays in weight and leading — none of it decided, all of it the sum of local
  choices. Deliberately a MEMBERSHIP rule, not an adoption rule: call sites keep
  writing `text-[13px]`; routing ~850 of them through named tokens would be a
  diff with no visual result and one more hop between a component and its own
  appearance.
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
commission/fold — one compact icon button in the header's right-aligned cluster,
hover-revealed via `SECTION_REVEAL` in `src/lib/hoverReveal.ts` and **only**
hover-revealed; locked by `src/lib/sectionAction.test.ts`. There was a
`revealActions` pin for EMPTY sections until 2026-08-13 — the owner rejected it
on sight (*"there are still section buttons constantly showed"*), and it deserved
rejecting: on a fresh project most sections are empty, so the exception was the
common case. Its `|| composing` half was redundant with the structure —
`SectionAction` stamps `data-open` from `expanded` and `SECTION_REVEAL` carries
`has-[[data-open=true]]:opacity-100`, so a disclosed form holds its own cluster
lit (UI-18's rule now rests there, and `src/lib/hoverReveal.test.ts` says so).
An empty section names its act in its COPY instead — "Nothing posted. Post a
work item…" says more than a glyph and costs the page nothing. **A
section's verbs ALL live in that one cluster** — owner directive 2026-08-13,
*"make all per-section buttons of the same style that show upon hover … normally
hidden"*. Two controls were outside it and each moved in: the project page's
solid "New session" (it starts a row in the Recent sessions list, so it is that
section's verb, not the page's — the header keeps only what belongs to the whole
project, like Watch), and the Discussion thread's floating Fold all · Unfold all
text pair. Neither was a bad button; each was a second answer to *how does a
section offer a verb*, which is what makes a page look busy while every
individual control looks fine) and
`FoldPairRow` in `src/components/SectionView.tsx` (every **Fold all · Unfold
all** row — a thread's roots and a page's sections are the same control at two
scopes, so one component draws both; each button renders only when it has work,
and they are never one toggle, SOCIAL-21. The arithmetic under them is pure and
therefore lives in `src/lib/replyTree.ts` — `draftLine` / `foldableRoots` /
`foldAllRoots` / `unfoldBranch`, locked in `src/lib/reply-tree.test.ts`) and
`src/lib/foldHeader.ts` (every foldable section
header) and `ResourcePageSection` in `src/components/ResourcePage.tsx`
(`FoldSection` at call sites; every SECTION of
a main page — ONE primitive, merged 2026-08-12 from the
`MainSection` / `SidePanel` pair that by then differed by an icon and half a
rem of margin. The icon survived that merge as "the adapted style" and went on
2026-08-13 (*"remove icons from section titles, unifying the style"*): an
optional decoration on a shared primitive is a standing invitation to two looks,
and twelve sections wore a glyph along no rule anyone could state. There is no
version of "which sections get an icon" easier to keep true than "none do", so
the prop is gone rather than made consistent — and the label went 11px → 12px,
since it and the rule under it are now the whole of what separates two sections.
A section's RULE sits in equal space —
the same 12px above it and below it (`SECTION_RULE_SPACE`), and 12 because that
is the vertical padding a `CardList` row already carries, so a list's first row
and a section's first line of prose start at the same distance under the stroke.
The companion is the vertical form of the indent-once rule: **space a thing
once, from the outside.** `divide-y` draws no border above its first row, so
that row's top padding is the space under a divider that is not there — under a
section rule it landed on top of the space the section had already left, which
is why a list section put its first line 20px down where a prose section put its
at 8. The section takes it back (`SECTION_LIST_UNDOUBLE`, selecting the
`data-card-list` stamp on its own first child) — the TOP only, and the missing
bottom half is the lesson: cancelling the last row's padding too made a
section's box end above its own content, so the gap between section boxes
measured 20 where the visible gap was 32 and the inter-section rhythm lock
correctly reported a third rhythm. **A negative margin that makes a box smaller
than what it contains is a lie every later measurement inherits.** Measured,
not read, by `e2e/project-page.spec.ts`: the constant
states the pair in two different units (a padding under a button carrying its
own `py-1`, and a straight margin), so a source scan could bless it only by
re-doing the arithmetic the browser is already doing.
Every rail destination derives from the page templates in
`src/components/ResourcePage.tsx`: `AtomicResourcePage` and
`CompositeResourcePage` specialize one private `ResourcePageFrame`, which owns
the `max-w-3xl` reading column, container query, page inset and review stamps.
This is React composition, not class inheritance or copied markup. Collection
roots once reopened to `max-w-7xl` and used a parallel `FoldGroupHeader`, so
Projects → Yours/Shared and Project → About/Discussion solved the same grouped-
resource problem with two grammars. The root pages now use `FoldSection` too;
their resource-specific row/card/timeline form stays inside it. Stable schema
sections persist; data-defined bands pass `persist={false}` so a user-created
project name never becomes an unbounded preference key. Both still register in
the composite page's in-memory fold scope, so Fold all / Unfold all is complete
without making a dynamic title durable chrome.

The template split is ONTOLOGICAL, never a visual-style classification
(UI-28). A composite contains canonical resources or declared sub-pages, so its
template alone opens structural-section registration and forces an addressed
section page open. An atomic leaf may still use `FoldSection` for information
regions, but those regions do not register as navigation children. A session is
atomic too: `ConversationPane` derives from `AtomicResourcePage` with its
`workspace` layout because an independently scrolling transcript plus fixed
composer is a true feature that the reading slot cannot express. Association
and provenance remain ref links, not composition. Before adding a template
feature, apply the equivalence test in
[`docs/design/resource-page-templates.md`](../docs/design/resource-page-templates.md):
new information/relation/state/place may extend the vocabulary; the same fact
regrouped, re-sorted, re-labelled or re-chromed must reuse its existing form.

That closure is **total and transitive**, not a list of root components that
looked right when the rule was written. Every `SECTION_INSTANCE_KEY` entry must
name an explicit canonical detail renderer; a detail id may never degrade to
"the index, scrolled and flashed" (the Models provider leaf was the escape that
earned this rule). Stable multi-group details — profile, published Agent,
artifact, provider, routine, context and maintainer account — express their
groups through the same `FoldSection`; atomic timelines vary only in the payload
inside `AtomicResourcePage` + the shared page-header frame, while Project and
Routine use `CompositeResourcePage`. A detail body split into another module does
not redraw the primitive or import its parent: `SectionView` injects the one
`MainPageSectionComponent` into `ArtifactDetailPage` and `ProposalsPanel`, and
the prop is required. `src/lib/page-grammar.test.ts` derives its detail key set
from `SECTION_INSTANCE_KEY`, enumerates the stable details and the argued atomic
exceptions, and scans those cross-file seams.

The Artifacts root's entry is a synopsis row, never a miniature body renderer
(UI-31). All five kinds carry the same index grammar—kind/name, excerpt,
descriptor/provenance/recency—through `ArtifactPreviewRow`; the rich document,
email, image, slide or sheet body begins only on the canonical artifact page.
The index is one column at every pane width, so scanning order cannot change at
a breakpoint. Locked by `src/lib/artifact-index-preview.test.ts` and the
artifact walk in `e2e/social-sharing.spec.ts`.

The Project pattern includes the **item projection and information boundary**,
not only the resource-page template + `FoldSection` around it (UI-34/UI-36).
`ResourcePageSynopsisRow` owns the Project ledger rhythm and type hierarchy
(13px identity, one 12px descriptor, one 11px metadata field), with no item
frame. Projects, Agents, Models, public directories, Your work, Dispatch and
administrative ledgers consume it or its frameless `ResourcePageList`
container. Effort, authority, full instructions, history and primary lifecycle
acts live on canonical detail pages; repeating them in an index turns
navigation into a crowded configuration card. `src/lib/index-synopsis.test.ts`
enumerates the adopters and locks both the three text steps and the Agents
detail-field boundary.

A page or hub has one standing action vocabulary (UI-35). `PageActionButton`
is the complete 32px role for New/Add verbs: the theme's `accent-tint` /
`accent-strong` soft face, one icon gap, a quiet theme-colored inset edge and a
stronger edge on keyboard focus. Projects, Artifacts, Contexts, Models,
Routines, Dispatch and Agent hub headers all use it; popover triggers keep the
same face by passing `aria-haspopup` / `aria-expanded` through the component.
`PageHeader` gives its identity group a growing 16rem basis and the action
cluster `ml-auto`, so a long subtitle wraps beside the action; a tight pane
wraps the whole control at the right instead of squeezing either side. Do not
place the same standing action in a fold's body or list toolbar: subview-specific
actions such as New agent and New prompt still belong to the hub's page header.
Do not extend this role to section verbs
(`SectionAction`), row actions, navigation doors, toggles or destructive
confirms—unification follows function. Locked by `src/lib/button.test.ts`.

Entity-page configuration is **folded and content open**; a section that opens
folded owes a `summary` — the thread's stub rule, an index entry and never a gap.
Posture persists per account keyed by TITLE (`src/lib/sectionFold.ts`), which is
what bounds the key space and imposes the one constraint worth knowing: two same-named sections MUST
declare the same `defaultFolded`, because they share a stored key. What is
deliberately NOT shared with the thread's fold is `src/lib/replyTree.ts` — a
discussion is a recursive tree, a page's sections are a flat list; the cue and
the Fold all · Unfold all rule are the parts that generalize. **Section ORDER is
bounded-before-growing** (owner directive 2026-08-13) — three bands separated by
how a section behaves after a year of use, not by what it is about: state ·
configuration · histories. The reasoning, including why Open work is band 1
(a queue is drained; a ledger only lengthens) and why this reversed the previous
day's config-at-the-tail decision, is at the render site in `ProjectDetail`.
Locked by `src/components/main-column-sections.test.ts`, `src/lib/page-grammar.test.ts`,
`src/lib/section-fold.test.ts` and `e2e/project-page.spec.ts` — the order lives
in the E2E alone, since a source scan and a rendered walk would be two
statements of one JSX sequence)
and `src/lib/pageHeader.ts` (every PAGE's opening title block — hub and
detail pages share one title look + container rhythm; the chrome bars
`SessionTitleBar`/`PanelShell` are a different role, deliberately distinct)
and `src/lib/scrim.ts` (every dimmed overlay backdrop — the tier scrims and
the dialog scrims alike) and `src/lib/popover.ts` (every anchored popover surface —
chrome + the stay-inside-the-viewport containment, applied by
`src/lib/usePopoverShift.ts` / `clampLeft`) and `src/lib/copyButton.ts` +
`src/components/CopyButton.tsx` (every copy-to-clipboard button — the rendezvous-secret
reveal and the A2A-card viewer alike, label swapping to "Copied" then self-resetting)
and `src/lib/formInput.ts` (every text FIELD's look, in **two shapes of one
cue**: `FORM_INPUT_CLASS` where a field is only a field, and
`FIELD_SHELL_CLASS` + `FIELD_BARE_CLASS` where it HOSTS its own verbs — a
composer's submit belongs inside the box, and a field cannot carry a button
while wearing its own border. The frame moves to the shell, the control keeps
the type, and the shell answers focus with `focus-within` because the element
wearing the frame is no longer the one taking the caret — miss that and the
field silently stops lighting on focus. The two shapes' text insets are held
equal by arithmetic in the lock, so they can't drift into two different-looking
fields) + `src/lib/focusContext.ts`'s
`FOCUS_FLASH_CLASS` (the lit highlight every door's target wears on arrival —
work item, comment, agent card, conversation turn), both locked by
`src/lib/form-input.test.ts`, and `src/components/AnchorThreadComposer.tsx` (the ONE
thread composer — the entity panel, the Commons card, the discussion's own page,
and the conversation's turn gutter all post through it, differing only by anchor;
locked by `src/components/thread-composer.test.ts`, which allows exactly one caller of
`postToDiscussion`/`openDiscussion` — the discussion page hand-rolled a second
composer for as long as this rule went unlocked. Inside a SECTION the composer is
**disclosed by the header's verb**, never left standing open (invariant UI-18);
a standing composer is only for a surface whose whole subject IS the thread)
and `src/lib/useMentionPicker.tsx` (the ONE `@`-mention completion — the thread
composer, the square, and both work-item comment fields; the roster is each
surface's own supplier in `lib/mentionPicker.ts`, never a directory. Two rules
live in the hook because both fail silently when re-derived: arming belongs to
TYPING (a caret move may only narrow or close), and an OPEN picker owns Enter —
which is why a host's keys pass THROUGH the hook rather than sitting beside it,
so a single-line field whose Enter posts can never post half a name. Locked by
`src/lib/mention-picker.test.ts`, whose pairing scan fails any field advertising a
mention in its placeholder that does not spread the picker's `fieldProps`)
and `src/lib/spinner.ts` + `src/components/Spinner.tsx` (every loading spinner — its
spin gated behind `motion-safe:` so it respects `prefers-reduced-motion`, WCAG 2.3.3;
the lock forbids ANY bare `animate-{spin,pulse,ping,bounce}` so no infinite animation
ships ungated — which also keeps a headless screenshot from chasing an animation that
never settles);
each shared cue is locked by a test
that fails if a component re-hardcodes it (`src/lib/addTrigger.test.ts`,
`src/lib/foldHeader.test.ts`, `src/lib/pageHeader.test.ts`, `src/lib/scrim.test.ts`,
`src/lib/popover.test.ts`, `src/lib/copy-button.test.ts`, `src/lib/spinner.test.ts`).
The same rule governs
shared *behaviour*, not just styling: every popover / dropdown / menu dismisses on
outside-click + Escape through one hook, `src/lib/useDismissable.ts` (locked by
`src/lib/useDismissable.test.ts`, which fails if a component re-hardcodes the document
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
three pickers) and locked by `src/components/model-picker.test.ts`, which fails if ANY
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
`src/api/connectivity-freshness.test.ts` + `server/store/event-tenancy.test.ts` (the
2026-07 connectivity audit's ratchet).

## Rail navigation is an inline disclosure tree

Sections render as a VSCode-explorer
tree (spec ADAPT-13): a section with sub-nodes carries a chevron and expands **in place**
— children indented below it, siblings staying put, **no push and no back button**. (The
earlier drill-in *replaced* the section list with a pushed sub-menu behind a "‹ Sections"
chip + a height-reservation hack; the odd post-click view that produced is exactly what
the tree fixes — a rail that reflows or navigates-away on expand is the bug.) The chevron
toggles children without navigating; the row body opens the page.

**A rail child is a PLACE; a partition is a FILTER** (invariant UI-19, owner
directive 2026-07-24). The rail is the account-resource FOREST and the main
page is the honest projection of the selected node (UI-28). A section has
exactly one kind of LIST child (surfaces or instances, never both), and may
carry a standing door beside it:

- **Declared surfaces** — `src/lib/subviews.ts` (`SECTION_SUBVIEWS`): a hub whose
  children are genuinely different PAGES. Agents is itself composite: the shared
  `agentStructure.ts` hierarchy is **Ready agents · Building blocks · Coordination ·
  Discover · Audit**; Building blocks preserves Prompts / Tools and Coordination
  preserves Your work / Commissions as another structural level before their live
  resource leaves. Its root is the complete overview, never one child disguised as
  the default. The maintainer console's panels are the other declared hub. The **Commons' four
  lenses** (Watched / Liked / Posted / Recently viewed) are surfaces too: the feed
  has no per-row page to list, and a lens is the VIEWER's own collection — a place
  you go back to — not a slice of the items. Each filters on a server-stamped,
  viewer-relative `CommonsItem` field (`watched` / `liked` / `mine` / `viewedAt`);
  a lens must never be a client-side guess, and `server/routes/commons-lenses.test.ts`
  fails a lens with no predicate (it would silently show the whole feed).
- **Instances** — `SECTION_INSTANCE_KEY`: a content section (Projects, Artifacts,
  Contexts, Models, Routines, Discussions) expands to the top `RAIL_INSTANCE_CAP` rows of the
  very list its page renders, with a "Show all — N more" tail row that unfolds the
  remaining rows in place ("Show fewer" folds them back — never a page jump).
  The key IS the `PaneSeed` field that opens one, so "the rail lists it" and "a row of
  it is addressable" are one fact — `/artifacts/:id` and `/models/:id` exist because
  of this rule. When the collection's main page places those instances inside
  named sections, the rail preserves that level too: `collectionSections.ts`
  drives **Artifacts → project → artifact**, **Contexts → family → context**
  (plus the account-MCP section), and **Models → Providers → provider** in both
  projections. Each intermediate place has `/:section/groups/:id`; it is not a
  second filter control, and the existing filter still owns which rows qualify.
- **Composite instances** — `src/lib/resourceNature.ts` classifies the account
  ontology independently of its renderers, while
  `src/lib/compositeSections.ts` declares each composite's ordered PAGE
  SECTIONS. An atomic resource stops at its row. A composite expands in three
  levels: **parent → section → canonical resource**. The section level may never
  be flattened away: About, Contributors, Context, Recent sessions, Discussion,
  etc. are addressable places that explain why their resource children belong
  together. The parent name opens the complete overview; a section name opens a
  main page containing only that section (forced open); resource rows keep their
  one canonical destinations. Viewer-private sections are absent from a visitor's
  rail and answer honestly when deep-linked. Association is not composition: a
  session's context bindings and artifact provenance do not turn the session
  into a branch. `src/lib/composite-sections.test.ts`,
  `src/lib/resource-nature.test.ts`, and `e2e/project-page.spec.ts` lock the
  registry, both projections, and the rendered hierarchy.
- **Standing doors** — a FIXED child whose place already has its own canonical
  address, so it links out of the section's URL grammar instead of extending it.
  There is exactly one (owner directive 2026-08-09): the Commons' **Your
  profile** (`OwnerProfileChild`), the door to your own public face. It sits with
  the social section rather than the account chip because *a profile is a social
  page, not an account setting* — the chip switches who you are; this goes to
  what you look like to everyone else. It is a door and not a sub-view because
  the page already answers to `/u/:name`, and `/commons/profile` would be a
  second address for it. That also fixed where profiles LIVE: `OWNER_SECTION`
  (`lib/paneNav.ts`) is now `commons`, and every byline, follower row, mention
  and roster entry opens it through the one funnel `useRelations().openOwner`
  — 22 call sites and four local aliases before. The door reads the
  **namespace's** name (`tenant.name`), never the person's: only a namespace has
  a profile. Locked by `src/lib/owner-door.test.ts` + `e2e/own-profile.spec.ts`.

A partition of a list by a property of its items — kind, state, ownership — is
**not** a child: it is a filter. Its STATE has one home
(`src/lib/sectionFilter.ts` + `useSectionFilter`, per account through `uiPrefs`)
and its CONTROL has two symmetric projections: the section row and the selected
composite main page both render `SectionFilterMenu` / the shared `FilterMenu`.
So: no in-page tab/dropdown that invents another grammar, no second sort state,
and no filter option masquerading as a rail child. The rail and page derive their
list with ONE function per section (`src/lib/sectionLists.ts`) over that ONE live
stored choice —
otherwise the rail's eight names are not the page's first eight, which is worse
than listing none. Routines is an instance branch in that same tree; its richer
status / project / cadence filter remains a dedicated funnel (`filterRoutines` +
`useRoutineFilter`), but the branch and the main page consume the SAME live,
per-account choice. Status is mutable metadata, so the neutral default is one
flat resource list; explicit Group by Status / Project choices may add page and
rail bands without turning them into structural tree nodes. There is no second
Routines pane. A
section lands on its **default** view (rail sub-view `null`; each hub body maps
null to its own default). Locked by `src/lib/section-subviews.test.ts` (inline tree
not a push; the registries disjoint; the shared-funnel pairing scanned both ways;
no bespoke second facet grammar), `src/lib/composite-controls.test.ts`,
`src/lib/section-lists.test.ts`, and
`src/lib/url-routes.test.ts` (every listed kind round-trips as a URL).

**Control symmetry is capability-total, not filter-specific** (owner
clarification 2026-08-16). Every RESOURCE-SCOPED standing capability of a
composite root is available from both projections: its primary New/Add action,
local search, Filter & sort, and Fold all / Unfold all. The one complete catalog
is `src/lib/compositeFeatures.ts`; the main page's real button/field/fold scope
answers the focused-pane command while `CompositeRailControls` is its compact
rail projection. Bulk disclosure publishes one revisioned request consumed by
both the active page registry and the matching nested rail branch. The rendered
form may adapt to density, but capability may not: split, close, resize, fold,
filter, search and scroll remain available on both sides through one state or
one shared primitive.
Locked by `src/lib/composite-features.test.ts`,
`src/lib/composite-controls.test.ts`, and `e2e/collection-symmetry.spec.ts`.
There are no content-container headers called **Sections** or **Recents**.
**Sessions is an ordinary top-level composite resource**: its row expands to the
same filtered session rows its `/sessions` main page renders, and both projections
subscribe to one `useSessionFilter` value. The rail remains one ordered forest.

Independent scrolling is a layout projection over that forest, not another
ontology. Rail views use the same generic `SplitNode` grammar and the same
`PaneActionButtons` as the main workspace, restricted to vertical (`col`)
splits. Focus chooses the command target: focus in main restores Split right /
Split down / Close pane; selecting any navigable rail entry hides Split right,
enables Split down, and anchors a new lower view with that selected entry at its
visual top. Each leaf still renders the complete honest forest, so the anchor
does not reparent a resource, mint a URL, or invent another hierarchy.

The focused rail view is the close target. Close pane deletes that leaf and
promotes its sibling through the same binary-tree rule as main; the last rail
view cannot close because an open rail must retain navigation. Views nest
arbitrarily, scroll independently, retain scroll memory by stable view id, and
persist their ratios/tree per account in `claude-ui.railsplit.v1`. The compact
Rail view options menu now owns only forest-wide Fold all / Unfold all—split and
close have one shared command home.

`src/lib/railSplit.ts` owns the pure vertical-only model,
`src/controller/useRailSplit.ts` owns focus/selection/tree edits, and
`src/components/RailSplit.tsx` renders it through the shared `ResizeHandle`.
A resizable rail omits its own right border because the
vertical handle owns the one boundary-aligned, persistent hairline; the eight-pixel hit
strip remains unchanged. (`top`/`bottom` pane handles keep the same persistent
hairline — form follows function.) Every `ResizeHandle` — rail width, panel width, split gutters — is
**keyboard-operable** (WCAG 2.1.1, invariant UI-11): a focusable, distinctly named
separator whose axis arrows run the same start→move→end pipeline as a pointer drag,
announcing its size + bounds (`aria-valuenow/-min/-max`, WCAG 4.1.2) from the same
constants the clamp enforces.
Two **labeled** `<nav>` landmarks keep the rail
landmark-unique (WCAG) *and* section rows navigation-scoped for e2e — "Create" (New
session) and "Sections" (the complete resource tree, including Sessions).
Locked by `src/lib/rail-split.test.ts` (vertical split, nesting, sibling
promotion and last-view guard) and
`src/components/resize-handle.test.ts` + `e2e/keyboard-resize.spec.ts` (the keyboard path).

The tree communicates depth without spending identity width: every expanded branch
uses the ONE `RailTreeBranch` guide, homogeneous leaves show their name rather than a
repeated kind word, and composite parents / structural sections / leaves step down in
type weight. A neutral left marker means **current location**; the softer
`focus-within` wash means keyboard focus only, so tabbing never impersonates
navigation. The rail toolbar is two spatial groups — global rail acts, then the main
view's split/close acts behind a divider. These are behavioral cues, not decoration;
`src/lib/rail-refinement.test.ts` locks their shared funnels and hierarchy coverage.

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
`src/lib/url-routes.test.ts`; spec row ADAPT-15. Companion rule — **titles are
doors**: a card / list row fronting a page makes its TITLE the primary click
target (GitHub's title-as-link), wired to the same handler as its containing
row's mouse door (`ResourcePageSynopsisRow`; the work-item title opens its thread).
Every such door — a title, a name inside a metadata line, a standing owner /
source byline — wears the one cue in `src/lib/textDoor.ts` (`DOOR_CLASS` /
`STANDING_DOOR_CLASS`); callers append only color, size and layout, for the
reasons the module states. External links, the dotted provenance opener, and
quiet ghost text *actions* (`INLINE_ACTION_CLASS`) are deliberately not doors.
Locked by `src/lib/text-door.test.ts` (invariant UI-16), whose scans read the
whole `src/` tree — the shape a one-home lock must have, since the file-scoped
version of this rule missed two strays for as long as it existed. The
container-level half is `src/lib/cardDoor.ts` (invariant UI-17): a card or list
row fronting a page opens it from **anywhere on its surface** — the title stays
the keyboard door and the accessible name, `cardDoorClick` + `CARD_DOOR_CLASS` /
`ROW_DOOR_CLASS` make the whole card the mouse target, and the funnel's guard
(not each child's `stopPropagation`) spares the controls nested inside. Never
`role="button" tabIndex={0}` on the container — that doubles the tab stop and
makes the card's whole text its accessible name. A card door needs no restating
"Open ‹thing›" action, and its hover cue must promise **exactly** what takes the
click: `src/lib/card-door.test.ts` scans that pairing in both directions, because
the bug it was earned for was a row that lit up wider than it was clickable.

**An addressable resource renders as a MAIN PAGE, never as a modal over its
parent list** (UI-29). URL and pane identity are not merely persistence for an
overlay: once `/artifacts/:id` names an artifact, the index yields to a normal
`AtomicResourcePage` with the shared header/back grammar and natural page scroll. Modals remain
for transient acts such as creating an artifact; the artifact itself is the
place. Locked structurally by `src/lib/artifact-page.test.ts` and in the DOM by
`e2e/social-sharing.spec.ts`.

## The back-history rule — an in-page door carries its origin; browser Back is per-page

(Owner directive 2026-07-17, spec ADAPT-18.) Every page opened by
clicking WITHIN a page carries a back affordance to the page that opened it —
across section boundaries and across the page↔conversation line (a session row
opens a conversation whose title bar leads with back; a breadcrumb opens a
project page whose back names the conversation). Mechanism: the pane's content
carries a `back` stack of `PaneLoc`s (`src/lib/paneHistory.ts` is the model;
`PaneBody` in `MainSplit.tsx` is the ONE push funnel for pane-originated doors);
chrome doors RESET the stack — top-level navigation starts fresh, GitHub's
top-nav rule, no exceptions. The **notification inbox is a PAGE**
(`/notifications`, owner directive 2026-08-08), which is how a bell keeps a way
home without one: its rows are ordinary in-page doors, so what a bell opens
carries the inbox on its back stack and Back is how you reach the next one.
That replaced a shell-level "pushing doors" bundle that had given the OVERLAY
the same behaviour — worth remembering as a shape: **when a rule needs an
exception, check whether the thing needing it is in the wrong form.** An
overlay can never be returned to, because it is not a place. The affordance is the one
`BackButton` (`src/components/BackButton.tsx`) on detail pages, hub `PageHeader`s
(when history exists), and the `SessionTitleBar`. **It names the page it opens**
— `resolveBackLabel` walks `PANE_SEED_KEYS` through `DETAIL_LABEL`, a mapped
type over `PaneSeed` so the compiler forces a label case for every detail kind
(the old chain named project / schedule / owner and let the rest fall silently
through to their SECTION: back from a profile landed on one thread and said
"Back to Discussions"). Names come from live registries — `BACK_LABEL_SOURCES`,
supplied by the ONE `BackButton`; the lock checks both that the function is
total and that its supplier feeds every source, because a complete function
handed a half-filled map degrades exactly like the bug (`src/lib/nav.test.ts`). Browser Back/Forward apply
per page too (`planPop`): pop the focused pane's own back top, else REFOCUS the
pane already showing the address (never clobber with a duplicate), else plain
route. When adding a door, decide which side of the page/chrome line it's on —
in-page doors must route through the pane funnel (or a push-flagged shell door),
never bare `routeToFocused`. Locked by `src/lib/pane-history.test.ts` +
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

**Identity copy names the OWNER, never "workspace"** (owner directive
2026-08-09). A workspace is the layer FWD-5 Phase 2 deleted — what owns and has
a profile is a **namespace** (a person or an org) — and the word is still live
here for two other things: the *adaptive split workspace* below, and a *context
workspace* (an attached folder). So identity surfaces say the name
(`profileTagline(name)` → "everything Ada Lovelace shares"), or "owner" /
"account" / "people" where a noun is unavoidable. Banned mechanically inside the
identity funnel — `src/lib/public-face.test.ts` scans `lib/publicFace.ts` +
`components/PublicFace.tsx` **comment-stripped** for the word, which suffices
because every byline, owner door and profile routes through those two files.
The signed-in twin is `src/lib/accountFace.ts`: one answer for what an account
row says beneath its name — the email, and the namespace **only when it is not
simply you** (the seeds wear their people's names, so `user.name` beside
`tenant.name` prints one name twice). Locked by `src/lib/account-face.test.ts`.

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
