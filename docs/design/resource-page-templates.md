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

The template adds three capabilities to the common frame:

1. rendered structural sections register themselves, so Fold all / Unfold all
   sees the exact viewer-relative page rather than a second title list;
2. a dedicated section-page route forces its selected section open, because
   navigation already performed the disclosure;
3. the parent overview, section page and canonical child pages can project the
   same registry without flattening the section level.

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

Fold scope is symmetric too. The main page discovers its rendered sections;
the rail exposes the same explicit Fold all / Unfold all pair and propagates a
single revisioned request through every nested branch. A top-level expansion
that mounts deeper children carries the request with it, so “all” never means
only the first visible depth.

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

## The equivalence test before adding a template feature

Augment a template only when a resource needs a capability that the existing
slots cannot express. Ask, in order:

1. Does the proposal expose new information, a new relation, a new state
   transition, or a new durable place?
2. Can the existing payload slot, section, synopsis row, timeline, diff or
   ref-link express it without losing meaning?
3. Is this merely the same information regrouped, re-sorted, re-labelled or
   wrapped in another piece of chrome?
4. Would adding it create a second control for state already owned by the rail
   filter, page header, section header or canonical detail page?

If the answer to 3 or 4 is yes, reuse the existing representation. A second
visualization of the same fact is not a “flexible template”; it is a second
answer the reader must reconcile. This is why a chronological Project activity
feed remains rejected: it would re-present the same work, sessions and changes
in a new order without revealing a new resource truth.

## Adoption map

- Composite: collection roots and declared hubs; Project and Routine overviews
  and section pages.
- Atomic reading pages: work items, contributions, discussions, artifacts,
  contexts, model providers, profiles, published agents, prompts, tools and
  maintainer accounts.
- Atomic workspace page: sessions (and their provisional draft surface) through
  `ConversationPane`.
- Shared vocabulary: `ResourcePageHeader`, `ResourcePageSection`,
  `ResourcePageList`, `ResourcePageActions`, `ResourcePageEmpty`, and
  `CompositePageFoldControls`.

The source lock in `src/lib/page-grammar.test.ts` enumerates the current page
families and fails if one falls back to a bespoke frame. The ontology lock in
`src/lib/resource-nature.test.ts` independently verifies which account resources
are branches and which are leaves; page appearance is never allowed to become
that registry.
