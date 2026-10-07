/** ── The solid button ─────────────────────────────────────────────────────────
 *  The one face for a SOLID action button (form follows function, like
 *  lib/textDoor and lib/ledger). Before this funnel the app spoke two primary
 *  languages at once — nineteen ink-dark solids (`bg-ink text-canvas
 *  hover:opacity-90`, the former page-header button included) beside the claret solids the
 *  consent cards wore — plus a third spelling on the destructive confirm
 *  (`bg-removed`, the DIFF hue, where the token contract says destructive is
 *  the danger ramp). Under the Claret direction the affirmative solid is the
 *  accent: solid claret means "go", solid signal-red means "danger", and the
 *  two never share a surface at the same weight (src/index.css).
 *
 *  The cue owns COLOR, WEIGHT, RADIUS and the hover (state change by ramp, not
 *  opacity — an opacity hover washes the label too). Radius is rounded-md: a
 *  button is a control, on the collections step of the radius scale
 *  (lib/ledger), not a card. Callers own SIZE (padding + text) and LAYOUT
 *  (flex, gap, shrink), which genuinely vary by container — the textDoor
 *  lesson. Ghost/text buttons (INLINE_ACTION_CLASS) and bordered secondaries
 *  are different roles, deliberately not here.
 *
 *  Plain strings so the DOM-less runner can scan — src/lib/button.test.ts locks
 *  the recipe and forbids the dead spellings tree-wide. */

/** The affirmative solid: claret, deepening on hover through the accent ramp's
 *  SOLID seat. The fill is `*-solid`, not `accent`, because it carries
 *  `on-solid` text: `accent` is tuned to be READ on the canvas, which in dark
 *  mode makes it far too light to sit white text on (this button shipped at
 *  2.20:1 on Forest dark, 1.74:1 on hover). Invariant UI-20, locked by
 *  src/lib/contrast.test.ts. */
export const SOLID_BUTTON_CLASS =
  'rounded-md bg-accent-solid font-medium text-on-solid transition hover:bg-accent-solid-strong'

/** The destructive solid: same anatomy on the danger ramp's solid seat — Delete,
 *  a dangerous Confirm. Pair with a plain-text Cancel, never with another solid. */
export const DANGER_BUTTON_CLASS =
  'rounded-md bg-danger-solid font-medium text-on-solid transition hover:bg-danger-solid-strong'

/** The SOFT verb — an affirmative action below the CTA tier (owner directive
 *  2026-08-03: the opaque claret read heavy at app scale). Approve on a consent
 *  card, Save/Post/Apply in forms and dialogs: same claret voice at a third of
 *  the weight — tinted fill, strong text, the fill deepening (never lifting)
 *  on hover. TRUE solids remain only where a surface has ONE defining act: the
 *  rail's New session, the auth Sign in, and the danger confirms. */
export const SOFT_BUTTON_CLASS =
  'rounded-md bg-accent-tint font-medium text-accent-strong transition hover:bg-accent/20'

/** The PAGE verb — one stable, theme-driven shape for an index or hub's
 *  standing action ("New project", "Add context", "New routine"). It is the
 *  soft affirmative face at a fixed 32px control height, with a quiet inset
 *  accent edge so its silhouette survives both light/dark mode and every
 *  palette. Unlike the face constants above, this is a complete ROLE: page
 *  headers must not choose their own size, icon gap, ring, or focus treatment. */
export const PAGE_ACTION_BUTTON_CLASS =
  `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 ${SOFT_BUTTON_CLASS} px-3.5 text-[13px] ring-1 ring-inset ring-accent/15 hover:ring-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-50`

/** The bordered SECONDARY: a neutral alternative such as Cancel beside a form's
 *  affirmative Save. It never competes with PAGE_ACTION_BUTTON_CLASS: page
 *  headers use the theme-colored page verb, while paired neutral choices keep
 *  this quiet frame and answer in accent only on hover. */
export const SECONDARY_BUTTON_CLASS =
  'rounded-md border border-line-strong bg-surface font-medium text-ink transition hover:border-accent hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-50'
