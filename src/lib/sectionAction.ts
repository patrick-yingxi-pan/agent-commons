/** ── The section-header icon action ───────────────────────────────────────────
 *  The compact icon button that sits in a SECTION HEADER's right-aligned action
 *  cluster — the section's verbs (edit the README, commission an agent, add a
 *  routine / context / tool, post a work item), one h-6 ghost square per verb.
 *  These used to be scattered text buttons ("✎ Edit", "+ Add routine") at panel
 *  feet and beside labels — each a different spelling, all permanently visible
 *  (the owner read the page as noisy chrome). Now one look, one place: label
 *  left, verbs right, revealed on section hover (lib/hoverReveal SECTION_REVEAL).
 *
 *  data-open marks a trigger whose popover is open — it keeps the button (and,
 *  via the cluster's has-[] variant, the whole cluster) visibly active while the
 *  popover is up, exactly like RowMenu's trigger.
 *
 *  A plain string (no JSX / imports) so the DOM-less Node test runner can import
 *  and assert it — tests/sectionAction.test.ts locks that every section-header
 *  action renders through the shared <SectionAction> component. */
export const SECTION_ACTION_CLASS =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink data-[open=true]:bg-panel-2 data-[open=true]:text-ink'
