---
name: ui-review
description: Exhaustive review of a UI change — derive the affected surface×viewport matrix from the diff, sweep it in the running app against the named invariants (docs/ui-invariants.md), judge screenshots for the aesthetic residue, and ratchet every confirmed finding into a new funnel-level invariant. Use after any change under src/ that renders.
---

# /ui-review — exhaustive UI review

Code review is exhaustive because the diff is the enumeration and a reader is
the oracle. UI review must build both: **enumerate** the cells the change could
affect (not the cells you edited), **check** each against named invariants, and
**judge** what invariants can't express. Never review from memory of what you
changed — memory produces plan-shaped checklists, which is how escapes happen.

## 1 · Derive the cell matrix from the diff

- `git diff --name-only <base>` (or the uncommitted diff). For each changed file
  under `src/`, map component → **every surface that renders it** (grep for
  importers transitively; `src/lib/` and shared primitives ⇒ ALL surfaces).
- Surfaces: the thread (demo session, a seeded workspace/repo session, a fresh
  draft), each sidebar section (Projects, Artifacts, Contexts, Agents,
  Scheduled, Dispatch, Customize), the auth screens, the intro/tour.
- Cross with the canonical viewports — **320×700** (extreme narrow), **375×812**
  (phone), **768×1024** (tablet), **844×390** (short landscape), **1280×800**
  (wide). A lib/primitive change sweeps all five; a leaf component sweeps the
  viewports whose tier renders it differently.
- List the matrix explicitly before sweeping, and say what you're *not*
  sweeping and why. Silent truncation reads as "covered everything".

## 2 · Sweep each cell mechanically

**Start with the checked-in harness**: with the dev server running,
`npm run ui:sweep` ([scripts/ui-sweep.mjs](../../../scripts/ui-sweep.mjs))
drives the full surface × viewport matrix — every `aria-haspopup` trigger
opened and measured, h-scroll and inert checks per cell, screenshots to
`.data/ui-sweep/` — and exits nonzero on violations. It reports **skips
loudly**; treat every skip as an unswept cell to cover by hand or by extending
the script (then check the extension in). For cells the harness doesn't model
(new surfaces, tour states), sweep manually per below.

Run the app (`preview_start`, dev config — never `vite preview`) and per cell:

- **Every invariant in [docs/ui-invariants.md](../../../docs/ui-invariants.md)**
  that applies. The mechanical checks:
  - no horizontal scroll: `documentElement.scrollWidth <= clientWidth` (UI-2)
  - popover containment: open each popover reachable on the surface; every
    `[data-popover]` bounding box inside the viewport with ≥7px margins (UI-1)
  - in-flow chrome on narrow: computed `position === 'static'` on toggles (UI-3)
  - `vh`/`h-screen`/re-hardcoded primitives: already locked by the source-scan
    tests — run `node --test` rather than re-checking by hand (UI-4/5/6)
- **Open the transient states** — popovers, dialogs, drawers, menus, confirm
  views, hover flyouts — don't just look at the resting page. Truncation bugs
  live in what opens, not what's already visible.
- **Content extremes** where the change touches lists/labels: longest seeded
  titles, many chips, empty states.

Preview-tool gotchas (hard-won): synthetic clicks need `mousedown`+`click`
dispatched via `preview_eval`, and React flushes async — `await` a ~50ms tick
before querying the result. `getBoundingClientRect()` serializes to `{}` —
return plain fields. Playwright trusted clicks are the authoritative hit-tested
signal; `preview_eval` dispatch bypasses hit-testing and can mask an
element-intercepts-pointer bug, so anything interaction-critical gets an e2e
assertion, not just a preview check. When probing open/closed state of a
collapsing container, measure the container that actually animates — clipped
children report their full layout rect (rects ignore ancestor overflow clips),
and Playwright counts clipped/occluded elements as "visible". Before trusting
the sweep's verdicts, make its failures loud: a harness that silently catches a
nav error reports a clean cell it never actually visited.

## 3 · Judge the residue

Screenshot each swept cell and judge against the rubric — the part invariants
can't express yet: misalignment, crowding, truncated text, overlapping
elements, illegible contrast, a control that reads as broken. Judge from the
screenshot as a user would, not from the code you know is there.

For a large matrix, fan the sweep out (agents per surface×viewport slice, each
reporting violations with repro coordinates) and adversarially verify findings
before reporting.

## 4 · Report, then ratchet

- Report each finding: cell, invariant violated (or "rubric"), repro, severity.
- **Every confirmed finding must end as a ledger row** — follow "The ratchet
  procedure" in `docs/ui-invariants.md`: name the invariant over all subjects,
  enforce at one `src/lib/` funnel, lock with an enumerating test (source-scan +
  browser assertion via a `data-*` stamp), append the row. The exit criterion
  is the row + lock existing, not the pixel being fixed.
- A finding with no nameable invariant (pure taste) is reported as such — don't
  invent a rule nobody's bug earned.
