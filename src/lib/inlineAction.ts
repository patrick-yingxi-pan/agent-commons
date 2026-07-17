/** ── The inline ghost text-button action ──────────────────────────────────────
 *  Base styling for the small "ghost text button" actions embedded in a surface's
 *  CONTENT: "Mark all read", the work-item thread toggle / Retract, "A2A card",
 *  "Propose a change", the EmptyState's "+ Add context". They are logically
 *  parallel — a quiet, secondary text action — so they must look parallel: same
 *  role ⇒ same look. One source of truth means the cue can't drift between
 *  copy-pasted copies. (Form follows function.)
 *
 *  NOT this role: a SECTION HEADER's verbs (edit / add / post / commission…) —
 *  those are the compact icon actions of lib/sectionAction.ts, hover-revealed in
 *  the header's cluster. This module once styled them as panel-foot text buttons;
 *  they moved to the headers in the 2026-07 noise pass.
 *
 *  A plain string (no JSX / imports) so the DOM-less Node test runner can import
 *  and assert it — see tests/addTrigger.test.ts. The "+ Add" specialisation (this
 *  class + a Plus glyph + dialog aria) is the AddTrigger component
 *  (src/components/AddTrigger.tsx). */
export const INLINE_ACTION_CLASS =
  'inline-flex items-center gap-1 text-[12px] font-medium text-ink-faint transition hover:text-ink'
