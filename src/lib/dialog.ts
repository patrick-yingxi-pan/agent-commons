/** ── The dialog surface ───────────────────────────────────────────────────────
 *  The one chrome every centered dialog panel wears (the Finder-style pickers,
 *  the notifications and search panels, the form dialogs in SectionView): a
 *  floating surface — 12px radius, a ring instead of a border, and the deep
 *  shadow that says "above the page". Dialogs are one of the FOUR things
 *  allowed to float under the flat direction (with lib/popover's menus, the
 *  tooltip, and the account menu) — src/lib/ledger.test.ts enforces that roster,
 *  and this module existing is what keeps SectionView itself off it.
 *
 *  Before this funnel the identical spelling was retyped at eight call sites
 *  (AddContextButton, artifactPreview, NotificationsPanel, SearchPanel, and
 *  four SectionView dialogs) — the UI-16 drift shape, one level up. Callers
 *  keep their own LAYOUT (width, max-height, flex column, `short:` variants);
 *  this string owns only the surface. */
export const DIALOG_SURFACE_CLASS =
  'overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong'

/** Forms and credential ceremonies keep their header/footer inside the dynamic
 * viewport. Only the body yields to scrolling; callers choose the panel width.
 * Pair all three classes and stamp the panel with data-bounded-dialog. */
export const BOUNDED_DIALOG_LAYER_CLASS =
  'fixed inset-0 z-50 flex justify-center overflow-y-auto px-4 py-4 sm:pt-[8dvh]'
export const BOUNDED_DIALOG_PANEL_CLASS =
  'relative flex h-fit max-h-[calc(var(--dialog-viewport-height,100dvh)-2rem)] max-w-full flex-col sm:max-h-[calc(var(--dialog-viewport-height,100dvh)-16dvh)]'
export const BOUNDED_DIALOG_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto'

/** Any bounded text reader needs a named keyboard entry point. */
export function namedReadRegionProps(label: string, marker: 'dialog' | 'routine-mcp' | 'conversation' | 'mcp-input') {
  return { [`data-${marker}-read-region`]: true, role: 'region', 'aria-label': label, tabIndex: 0 } as const
}

/** Preserve the established dialog consumer contract over the shared semantics. */
export function dialogReadRegionProps(label: string) {
  return namedReadRegionProps(label, 'dialog')
}
/** `display: contents` has no box for the spacing selector to separate. */
export const FORM_DIALOG_FIELDS_CLASS = 'min-w-0 space-y-4'
