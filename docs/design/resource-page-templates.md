# Resource-page templates — the content half of rail/page symmetry

This note is the implementation companion to invariant **UI-28**: the left rail
and the main page are two projections of one account-resource ontology. The rail
answers “where is this node in the forest?”; the main page answers “what is this
selected node, honestly and completely?” Neither surface may invent a different
structure for the same resource.

The shared implementation is
[`src/components/ResourcePage.tsx`](../../src/components/ResourcePage.tsx).
React composition is the inheritance mechanism here: `AtomicResourcePage` and
`CompositeResourcePage` specialize one private `ResourcePageFrame`; pages do not
subclass a component or copy its markup.

## The common contract

Both templates inherit the parts whose role never changes:

- an explicit resource nature and one DOM review handle;
- for reading pages, one natural-scroll surface, one `max-w-3xl` column and a
  page-width container query, because a page may occupy the whole surface or
  half of a split workspace;
- reading pages add the shared page-title, action, section, list and empty-state
  vocabulary; the workspace layout keeps the session title bar and composer its
  behavior requires;
- ordinary collection entries share `ResourcePageSynopsisRow`: identity,
  one distinguishing descriptor and one small state/count field, with a
  responsive information hierarchy and no item frame;
- canonical back-history, semantic headings, keyboard-operable controls and
  token-driven styling (including honest `aria-expanded` where disclosure
  exists);
- `data-resource-page` and `data-resource-nature` handles so a browser sweep can
  enumerate the contract rather than infer it from pixels.

Nature-specific payload remains a slot, not a reason to redraw the frame. A
timeline, diff, document, synopsis list, settings form or conversation workspace
keeps the form its data requires inside the selected layout.

## Composite resource page

Use `CompositeResourcePage` only when the selected node **contains canonical
resources or declared sub-pages**. Its sections are structural places, not
decorative group labels.

The template adds five capabilities to the common frame:

1. rendered structural sections register themselves, so Fold all / Unfold all
   sees the exact viewer-relative page rather than a second title list;
2. a dedicated section-page route forces its selected section open, because
   navigation already performed the disclosure;
3. the parent overview, section page and canonical child pages can project the
   same registry without flattening the section level.
4. `CompositePageControls` keeps an applicable filter in page flow and reports
   the page's complete Fold all / Unfold all work to the shell's focused
   `PaneActionButtons`; it never redraws a second page-top fold pair.
5. `compositeFeatures.ts` closes the resource-scoped capability set: primary
   New/Add action, local search, Filter & sort, and bulk disclosure must each be
   reachable from the rail and the main page. The rail uses a compact overflow
   projection; it invokes the page's real callback/field in the focused pane,
   never a second creation flow or search state.

The rail projection is **parent → section → canonical resource**. The main-page
projection is the parent overview with every visible section, or one selected
section, or the child resource’s own page. Hubs and collection roots use the
same template because their declared surfaces or instance rows are real child
places. A collection root must not flatten headings its main page makes
structural: Artifacts projects the project filing section before each artifact;
Contexts projects Connectors / MCP servers / Repositories / account MCP access;
Models projects Providers. Those intermediate nodes use the canonical
`/:section/groups/:id` grammar, and the shared grouping functions feed both
surfaces. A filter may still choose which rows are visible, but it cannot erase
the section level that organizes those rows on the page.

Fold scope is focus-relative. The one `Organize pane` menu sits with Split and
Close in shell chrome. Main focus uses the rendered page's live registry;
main-page discovery includes data-defined bands, which join the in-memory fold
scope while retaining `persist={false}`. Rail focus instead scopes the request
to the selected canonical subtree in that one rail pane, including the selected
entry itself. Sibling branches retain their posture. The same menu exposes an
explicit entire-panel scope that reaches every root and nested branch; a
user-created title never grows `uiPrefs` merely to participate.

Filter scope follows the same symmetry without confusing representation with
state. The rail row and main-page toolbar both render `SectionFilterMenu` (or
the routine-flavoured shared menu) and subscribe through one live per-account
hook. A choice made in either place updates both controls, the rail's ordered
head, and the page list. This is two projections of one state—not two filters.
Filter options remain properties of the view and therefore never become tree
children; structural section nodes remain places and are never flattened by a
filter.

### One collection model, two density templates

A collection body is not assembled independently inside `SectionView` and the
sidebar. It is declared as a typed `CollectionProjection`: a section identity,
ordered runtime groups, ordered item identities, empty answers, and a small
discriminated grammar:

- `flat + partition` — one unnamed list in both projections;
- `static + partition` — one named, non-folding list in both projections;
- `foldable + partition` — a named view list (state/ownership/time) that folds
  in both projections without becoming a canonical place;
- `foldable + section` — a structural, addressable intermediate place in both
  projections.

`MainCollectionTemplate` renders that description through the shared page list
and section primitives. `RailCollectionTemplate` renders it through the shared
lead-column tree and list-partition primitives, applying only a density cap; it
preserves every named group and any addressed/rooted row beyond the cap. The
resource-specific row is the ordinary render slot. A standing structural group
with no rows may supply content through the explicit empty-group payload slot
(the account MCP access panel is the one current example), while the template
still owns its heading, disclosure and spacing. Consumers therefore cannot make
“Active” a foldable page list but a static rail tag, or add a page-only
“Threads” wrapper: those combinations are no longer expressible at the call
site.

This is still projection symmetry rather than DOM identity. The page may show
all rows while the rail initially caps them, and row payloads adapt to available
width. The classification, ordering, disclosure capability, empty meaning and
canonical identity are shared data. Browser stamps compare the rendered group
keys from both templates; source locks enumerate every collection-root consumer
and fail if it redraws the body locally.

Sessions demonstrates the distinction between a composite collection and an
atomic child. `/sessions` is a `CompositeResourcePage`: the complete filtered
collection, its New session capability, and its synopsis doors. Each `/s/:id`
conversation remains an `AtomicResourcePage` with the workspace layout its
transcript and composer require. The rail's Sessions row projects the composite;
its session children door to the same atomic pages. One `useSessionFilter` store
feeds the rail and collection page, so “Sessions” is a resource name rather than
the former utility-container label “Recents.”

Primary actions and local search follow the same rule without pretending their
layouts are identical. The page keeps the full `PageActionButton` and field in
the reading flow; the rail exposes their labels as compact menu rows. Choosing
one routes the focused pane to the composite root, then the page's own handler
opens the dialog or focuses its own field. The command remains pending across
that route and only the focused pane may consume it, so a split view showing a
second copy cannot steal or duplicate the action.

This is feature symmetry, not pixel symmetry. Every resource fact and standing
operation is reachable in both projections, while density may adapt the control:
a full page button may become a rail menu row; a rail's capped disclosure and a
page's complete list are two ways to reach the same full set.

Layout capabilities are symmetric through one focus-aware command surface too.
The shared `PaneActionButtons` target the area that most recently received
pointer or keyboard focus. Main focus preserves Split right / Split down / Close
pane. Selecting any navigable entry in any rail view changes that same cluster
to rail semantics: only vertical Split down is available, the new view makes
the selected canonical node its visible root, and Close pane deletes only a
focused rooted secondary view. The complete forest never closes and remains the
recovery path from every rooted projection. The node's descendants remain; its ancestors and siblings
outside that subtree are absent. Both surfaces reuse `SplitNode`, sibling
promotion and `ResizeHandle`; the rail restricts direction because its geometry
is already a narrow column. This rooted projection does not change ontology,
identity or URL; restore prepends the complete forest when a legacy persisted
layout is missing it. `Organize pane` and `Split pane` are grouped controls in
the same focus-aware cluster; Close remains direct and terminal, so the
constrained header has one disclosure home without losing command distinction.

## Atomic resource page

Use `AtomicResourcePage` when the selected node is a leaf. The template shares
the frame and header but deliberately opens **no structural-section scope**.

An atomic lifecycle may be a timeline; an artifact may be a document; a
connector may expose settings. Reading pages use the default layout. A session
selects `layout="workspace"`: its transcript scrolls independently above a
fixed composer and may tile beside another pane. That is a true feature the
reading slot cannot express without losing behavior, so the template owns this
one explicit layout variant. `ConversationPane` still derives from
`AtomicResourcePage`, retains its canonical session handle, and opens no
structural-section scope. A fresh draft uses the same provisional surface and
becomes a canonical session when its first turn materializes.

An atomic page may still contain information regions such as Content, Sharing,
History or Configuration. Those are facets of one resource unless they contain
independently addressable account resources. `ResourcePageSection` can disclose
such a region without turning it into a rail child. This separation prevents a
visual layout choice from silently changing the ontology.

Association is not composition. A session may bind contexts; an artifact may
name a producing session; an agent may use tools. Those relations deserve live
doors where canonical targets exist, but they do not make the host a branch.

## Complementary item projection

The page frame and the item projection solve different halves of the same
consistency problem. `ResourcePageList` supplies frameless hairline separation;
`ResourcePageSynopsisRow` supplies the Project main-page hierarchy: 13px
identity, one 12px descriptor and one 11px metadata field. Identity and state
survive a narrow split pane; the descriptor yields first. A whole-row pointer
door shares its destination with the title's keyboard door, while nested
row-local controls keep their own click.

This row is for choosing an addressable resource, not administering it. A
provider's authority, an agent's full definition, publication history, audit
details and primary lifecycle acts begin on their canonical pages. Keeping that
boundary is what makes an index visually simple without making it dishonest.

Containment remains available when it adds semantic information: a rich feed
post, diff, editor, form or independently comparable metric tile is a bounded
object. A box around an ordinary synopsis merely repeats the section boundary
and is not a template feature.

## The equivalence test before adding a template feature

Augment a template only when a resource needs a capability that the existing
slots cannot express. Ask, in order:

1. Does the proposal expose new information, a new relation, a new state
   transition, or a new durable place?
2. Can the existing payload slot, section, synopsis row, timeline, diff or
   ref-link express it without losing meaning?
3. Is this merely the same information regrouped, re-sorted, re-labelled or
   wrapped in another piece of chrome?
4. Would adding it create a second state or visual grammar instead of another
   synchronized projection of the existing rail/page control?

If the answer to 3 or 4 is yes, reuse the existing representation. A second
visualization of the same fact is not a “flexible template”; it is a second
answer the reader must reconcile. This is why a chronological Project activity
feed remains rejected: it would re-present the same work, sessions and changes
in a new order without revealing a new resource truth.

## Adoption map

- Composite: collection roots (including Sessions) and declared hubs; Project
  and Routine overviews and section pages.
- Atomic reading pages: work items, contributions, discussions, artifacts,
  contexts, model providers, profiles, published agents, prompts, tools and
  maintainer accounts.
- Atomic workspace page: sessions (and their provisional draft surface) through
  `ConversationPane`.
- Shared vocabulary: `ResourcePageHeader`, `ResourcePageSection`,
  `ResourcePageList`, `ResourcePageSynopsisRow`, `ResourcePageActions`,
  `ResourcePageEmpty`, `MainCollectionTemplate`, `RailCollectionTemplate`,
  `CompositePageControls`, and `SectionFilterMenu`; collection data is declared
  through `CollectionProjection`.

The source lock in `src/lib/page-grammar.test.ts` enumerates the current page
families and fails if one falls back to a bespoke frame. The ontology lock in
`src/lib/resource-nature.test.ts` independently verifies which account resources
are branches and which are leaves; page appearance is never allowed to become
that registry.
