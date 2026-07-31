/** ── The dialog surface ───────────────────────────────────────────────────────
 *  The one chrome every centered dialog panel wears (the Finder-style pickers,
 *  the notifications and search panels, the form dialogs in SectionView): a
 *  floating surface — 12px radius, a ring instead of a border, and the deep
 *  shadow that says "above the page". Dialogs are one of the FOUR things
 *  allowed to float under the flat direction (with lib/popover's menus, the
 *  tooltip, and the account menu) — tests/ledger.test.ts enforces that roster,
 *  and this module existing is what keeps SectionView itself off it.
 *
 *  Before this funnel the identical spelling was retyped at eight call sites
 *  (AddContextButton, artifactPreview, NotificationsPanel, SearchPanel, and
 *  four SectionView dialogs) — the UI-16 drift shape, one level up. Callers
 *  keep their own LAYOUT (width, max-height, flex column, `short:` variants);
 *  this string owns only the surface. */
export const DIALOG_SURFACE_CLASS =
  'overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong'
