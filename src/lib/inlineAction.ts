/** ── The inline panel-foot action button ──────────────────────────────────────
 *  Base styling for the small "ghost text button" actions that sit at the foot of
 *  a side panel: the "+ Add ‹thing›" picker openers (project page **Add routine** /
 *  **Add context**, schedule page **Add tool**) and the Pencil edit-toggles (**Add
 *  instructions**, **Edit destination**, **Edit schedule**). They are logically
 *  parallel — a quiet, secondary action tucked under a panel's content — so they
 *  must look parallel: same role ⇒ same look. One source of truth means the cue
 *  can't drift between copy-pasted copies; change it once and every one follows.
 *  (Form follows function.)
 *
 *  A plain string (no JSX / imports) so the DOM-less Node test runner can import
 *  and assert it — see tests/addTrigger.test.ts. The "+ Add" specialisation (this
 *  class + a Plus glyph + dialog aria) is the AddTrigger component
 *  (src/components/AddTrigger.tsx); the Pencil edit-toggles wear the class directly. */
export const INLINE_ACTION_CLASS =
  'inline-flex items-center gap-1 text-[12px] font-medium text-ink-faint transition hover:text-ink'
