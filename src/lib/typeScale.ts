/** ── The type scale: a CLOSED set of sizes, weights and leadings ─────────────
 *  Owner directive 2026-08-13: *"reduce the number of font sizes, types and
 *  styles. These help visual cleanness a lot."*
 *
 *  It was measured first, because the number is the argument. One project page
 *  carried twelve distinct type styles across six sizes; the tree carried
 *  **fourteen sizes** — 8, 9, 10, 10.5, 11, 11.5, 12, 13, 14, 15, 18, 20, 24,
 *  30 — five of them inside a four-pixel band, plus two spellings for one size
 *  (`text-xs` beside `text-[12px]`, `text-sm` beside `text-[14px]`). Nobody
 *  chose that: each was one call site's local decision, and the page reads busy
 *  because a reader is asked to rank sizes that differ by a pixel, which is a
 *  distinction they can see and cannot name.
 *
 *  So the scale is closed at SEVEN steps, each with a job. What makes it hold
 *  is not this table — it is `type-scale.test.ts`, which scans the tree and
 *  fails on any font-size, weight or leading utility that is not below. A scale
 *  that is only written down is a scale that grows a half-step the next time
 *  something looks 1px off.
 *
 *  Deliberately NOT a set of components to import. Call sites keep writing
 *  `text-[13px]` where they always did; what changed is that the set they may
 *  draw from is finite and machine-checked. The alternative — routing ~850
 *  sites through named tokens — is a diff with no visual result and one more
 *  indirection between a component and its own appearance. The rule worth
 *  enforcing is membership, and membership is what the lock enforces. */

/** The seven sizes, and the job each one holds.
 *
 *  Spelling matters as much as the value: ONE class per size, so a size cannot
 *  be searched for two ways. The small tier is written in pixels because it is
 *  a custom 1px-step ramp Tailwind has no names for; the display tier keeps
 *  Tailwind's own names, which is where `PAGE_TITLE_CLASS` already lives (and
 *  `pageHeader.test.ts` holds the alternate spelling `text-[24px]` dead — a
 *  drift this table now generalizes rather than replaces). */
export const TYPE_SIZE = {
  /** 10px — caps badges, count chips, the unread badge. Never prose. */
  micro: 'text-[10px]',
  /** 11px — the metadata line under a row's title: who, when, how many. */
  meta: 'text-[11px]',
  /** 12px — section labels, control labels, dense secondary copy. */
  label: 'text-[12px]',
  /** 13px — primary content: row titles, body copy, form fields. */
  body: 'text-[13px]',
  /** 15px — reading size: message prose, the composer, an object's own title. */
  read: 'text-[15px]',
  /** 20px — a hub or empty state's heading. */
  title: 'text-xl',
  /** 24px — the page title (`PAGE_TITLE_CLASS`). */
  display: 'text-2xl',
} as const

/** The one RELATIVE size, and why it is not one of the seven.
 *
 *  Inline code inside prose (`lib/rich.tsx`) shrinks to sit in whatever text it
 *  lands in — a message at 15px, a row at 13px, a chip at 11px. An absolute step
 *  cannot do that job: pick 13px and the same class is correct in a message and
 *  oversized in a chip. So the size is expressed as a RATIO of its host, which
 *  is a different kind of decision from a step on the ramp and is declared here
 *  rather than smuggled in as an eighth size.
 *
 *  One entry, and the lock enforces that: a second relative size would be a
 *  ratio nobody could name, which is the defect the ramp was closed to stop. */
export const TYPE_SIZE_RELATIVE = {
  /** Inline `code` inside prose — 85% of whatever it sits in. */
  code: 'text-[0.85em]',
} as const

/** Three weights. `font-bold` (700) had exactly one call site tree-wide, on a
 *  10px glyph badge, where it is indistinguishable from 600 — the definition of
 *  a style nobody chose. */
export const TYPE_WEIGHT = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
} as const

/** Four leadings, named. The numeric spellings (`leading-4`, `leading-5`) were
 *  each used once and each duplicated a named step at the size it was paired
 *  with, so they said nothing the name did not. */
export const TYPE_LEADING = {
  none: 'leading-none',
  tight: 'leading-tight',
  snug: 'leading-snug',
  relaxed: 'leading-relaxed',
} as const

/** Three families, which is the "types" half of the directive and is already
 *  where it should be: serif TITLES, sans everything, mono for code and
 *  machine-readable values. */
export const TYPE_FAMILY = {
  serif: 'font-serif',
  sans: 'font-sans',
  mono: 'font-mono',
} as const

/** ── The one declared role exemption ─────────────────────────────────────────
 *  `components/artifactPreview.tsx` renders a MINIATURE of a document at three
 *  zooms (thumb · compact · full), so its type ladder is the DOCUMENT's, not
 *  the UI's: 8px body under a 9px heading is not a UI size anyone reads, it is
 *  a thumbnail of a page at roughly 60% scale. Forcing it onto the UI scale
 *  would not unify anything — it would make the thumbnails illegible while
 *  adding two sizes to the set every other surface has to obey.
 *
 *  `components/StructuredArtifactView.tsx` is the extracted sheet/slide portion
 *  of that same renderer, shared with consent. Its 8/9px sizes remain limited
 *  to the explicit `thumb` zoom; ordinary consent and full views use UI steps.
 *  This preserves the existing miniature role, not a new UI type scale.
 *
 *  The exemption names exact FILES, not a pattern, so it cannot quietly widen.
 *  A new role wanting in is a design conversation, not a list edit.
 *
 *  The code measure `leading-[1.7]` on `<pre>` blocks is exempt for the same
 *  shape of reason — a monospace block is set to a line grid, not to the UI's
 *  named leadings — and is allowed only on `font-mono` lines. */
export const TYPE_SCALE_EXEMPT_FILES = ['components/artifactPreview.tsx', 'components/StructuredArtifactView.tsx'] as const
