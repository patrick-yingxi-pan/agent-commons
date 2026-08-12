/** ── Page-title headers ───────────────────────────────────────────────────────
 *  The title block every full PAGE opens with — the hub pages (Projects,
 *  Artifacts, Contexts, Models, Agents, Scheduled, Dispatch, Customize) and the
 *  detail pages (project, work item, context, schedule, owner profile, agent).
 *  One role ⇒ one look (the form-follows-function rule): before this module the
 *  same role wore four title spellings (a dropped font-semibold on the work-item
 *  page, a stray text-[24px], leading-tight on one page only) and three
 *  container rhythms (mb-6 / mb-5 / none) — pure copy-paste drift.
 *
 *  NOT in scope, deliberately: the conversation's SessionTitleBar and the
 *  context panel's PanelShell header. Those are compact chrome BARS (border-b,
 *  fixed height, sans) — a different role from a page's opening title block, so
 *  they keep their own primitives. Don't "helpfully" unify a bar with a title.
 *
 *  Plain strings (no JSX, no imports) so the DOM-less Node test runner can
 *  import and assert them — src/lib/pageHeader.test.ts locks that no component
 *  re-hardcodes the look. Consumers may APPEND functional extras (`truncate` on
 *  long user-named titles, input chrome on the rename-in-place variant) — the
 *  family/size/weight/color are what must not fork. */

/** The one page-title look. */
export const PAGE_TITLE_CLASS = 'font-serif text-2xl font-semibold leading-tight text-ink'

/** The one back control: a compact circular ghost icon-button sitting INLINE on
 *  the title line — the first element of the header's identity group — so back +
 *  title read as one unit. (It once floated as a small "← Label" eyebrow a full
 *  margin above the title — the owner read it as disconnected chrome.) The
 *  destination stays NAMED via title/aria-label ("Back to ‹live label›"); h-8
 *  optically centers on the text-2xl leading-tight title line; -ml-2 hangs the
 *  arrow into the page gutter so the title keeps the content edge. */
export const PAGE_BACK_CLASS =
  '-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-panel-2 hover:text-ink'

/** The one page-header container: a left identity group and an optional right
 *  action cluster, wrap-friendly (a header must survive a half-width split
 *  pane, UI-9), one bottom rhythm. */
export const PAGE_HEADER_CLASS = 'mb-6 flex flex-wrap items-start justify-between gap-3 max-sm:mb-3'
