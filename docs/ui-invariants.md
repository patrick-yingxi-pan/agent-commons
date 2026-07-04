# UI invariants — the ratchet ledger

> The named, machine-checkable rules every rendered surface must satisfy — the
> **oracles** behind `/ui-review` (`.claude/skills/ui-review/SKILL.md`). Each
> invariant exists because a real escape reached the user; none was invented
> speculatively. That's the ratchet: an invariant is *earned* by a bug, then
> enforced at one funnel and locked by a test that enumerates **all** its
> subjects — so the class dies, not the instance.

## Why a ledger

Code review is exhaustive because the diff *is* the enumeration and a reader is
a cheap oracle. UI review has neither by default: the artifact is rendered
behavior over **surfaces × viewports × transient states × content extremes**,
and "looks right" isn't machine-checkable as stated. This ledger is the fix for
the oracle half — it converts aesthetic judgments into named rules a sweep can
assert. The enumeration half is the repo's *shared-primitive* architecture:
because every popover / scrim / fold-header / add-trigger routes through one
primitive, a single generic test (or a `data-*` stamp) can visit all of them.
**Shared primitives are the enumeration handle that makes exhaustive review
tractable** — that's why "form follows function" (AGENTS.md) is a testing
strategy, not just a styling rule.

## The invariants

| ID | Invariant | Funnel (enforced at) | Lock (fails on regression) | Earned by |
|----|-----------|----------------------|----------------------------|-----------|
| UI-1 | **A popover lies fully inside the viewport** (≥ `POPOVER_MARGIN` from every edge). Anchored surfaces wear `POPOVER_SURFACE` (carries the width clamp) and self-correct via `usePopoverShift` — height-clamped to the viewport (scrolling inside when taller) then shifted; the hook stamps `data-popover`, the browser-side enumeration handle. Portal-fixed menus clamp through `clampLeft`. | `src/lib/popover.ts`, `src/lib/usePopoverShift.ts` | `tests/popover.test.ts` (math + every consumer + no-re-hardcode scans), `e2e/responsive.spec.ts` (320×700: every composer popover's box inside the viewport; 844×390: an over-tall popover clamps and scrolls) | Composer popovers truncated at extreme narrow widths (2026-07): containment had been applied per-instance — one `max-w` in AddContextButton, hand-rolled clamp math in three portal menus — instead of at a funnel. The height half was found by the first `/ui-review` sweep itself (844×390: two popovers taller than the viewport pinned top, bottom unreachable). |
| UI-2 | **No horizontal scroll, ever** — `documentElement.scrollWidth ≤ clientWidth` on every surface at every viewport. | narrow-tier layout rules in `src/lib/viewport.ts` + wrap/truncate discipline (`min-w-0`, `flex-wrap`) | `e2e/responsive.spec.ts` (asserted at boot, mid-thread, after panel close) | The responsive build (ADAPT-11): section headers and pill strips clipped/overflowed at 375px. |
| UI-3 | **Chrome never floats over scrollable content on narrow** — controls are in-flow (computed `position: static`), so content can't slide underneath them. Wide/medium may float only where layout indents reserve the spot. | `NarrowBar` / `SessionTitleBar` `leading` slot in `src/App.tsx` | `e2e/responsive.spec.ts` (narrow rail toggle's computed position must be `static`) | User report (2026-07): the floating rail-reopen button overlapped thread content on phones. |
| UI-4 | **Every dimmed backdrop is the one scrim** — same darkness, same cue, tier overlays and dialogs alike. | `SCRIM_CLASS` in `src/lib/scrim.ts` | `tests/scrim.test.ts` (consumers + no-re-hardcode) | The responsive build: the shell's two new tier scrims found four dialogs each hand-rolling their own backdrop. |
| UI-5 | **Every popover/menu/dropdown dismisses on outside-click + Escape** through one hook. | `src/lib/useDismissable.ts` | `tests/useDismissable.test.ts` (no re-hardcoded document `mousedown` listener) | Pre-existing (form-follows-function) — dismissal behavior had drifted between copies. |
| UI-6 | **Viewport-relative units are `dvh`, never `vh`/`h-screen`** (iOS URL-bar collapse makes `vh` overshoot the visible viewport). | usage rule, scanned repo-wide | `tests/viewport.test.ts` (source scan: any `NNvh` or `h-screen` in `src/` fails) | The responsive build converted the shell; writing this ledger swept the rest and found four stragglers (artifact viewer + section dialogs) — the scan now closes the class. |

| UI-7 | **Hover-revealed affordances are persistent or absent below `sm` — never invisible-but-space-reserving.** Touch has no hover: a real control wears `HOVER_REVEAL` (persistent on narrow), a decorative cue wears `HOVER_CUE` (gone on narrow). An `opacity-0` element that still occupies layout starves the row's flex-1 identity column. | `src/lib/hoverReveal.ts` | `tests/hoverReveal.test.ts` (cues resolve the narrow tier; no inline `opacity-0`+`group-hover:opacity-100`), `e2e/responsive.spec.ts` (320px: a Scheduled routine's name keeps readable width) | The first `/ui-review` sweep's judgment pass (2026-07): at 320px the Scheduled and Contexts rows showed icon + pill + toggle and **no name** — the invisible hover cluster plus the status pill had squeezed the name column to ~0px. |

Candidate (not yet earned by an escape, noted for the sweep): centered **dialogs**
clamp themselves today (`max-w-[calc(100vw-16px)]` + `max-h` per dialog); if a
dialog ever ships without one, extract a `DIALOG_SURFACE` funnel the same way.

## The ratchet procedure

When a UI escape is confirmed (by a user report or a `/ui-review` sweep):

1. **Name the invariant** the bug violated — as a rule over *all* subjects, not
   this instance ("popovers lie inside the viewport", not "widen the usage
   popup's margin").
2. **Enforce at one funnel** — a shared constant / hook / pure function in
   `src/lib/`, adopted by every subject. If subjects already share a primitive,
   the invariant lands there; if they don't, unifying them *is* the fix
   (encode invariants centrally — never patch the one place it was noticed).
3. **Lock with an enumerating test** — a source-scan that fails when a subject
   skips the funnel or re-hardcodes it (`tests/popover.test.ts` pattern), plus a
   browser assertion where rendering matters (a `data-*` stamp from the funnel
   makes subjects enumerable in the DOM).
4. **Append a row here** — statement, funnel, lock, origin. The exit criterion
   for the fix is this row existing, not the pixel being right.

Keep the list short and earned: a rule nobody's bug ever violated is checklist
bloat that dilutes the sweep.
