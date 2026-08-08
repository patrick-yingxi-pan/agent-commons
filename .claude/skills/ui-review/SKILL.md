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

The full oracle catalog — the earned invariants PLUS the exhaustive rubric
tier (function F-rules and aesthetic A-rules, each with its mechanical
detection and fix procedure, and the severity/fix policy) — is
[docs/review-rulebook.md](../../../docs/review-rulebook.md). Run this skill's
sweep as the rulebook's phases 1–3; triage and ratchet per its §3–§4.

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
- **The ACCOUNT is a third dimension, not a setting** (owner directive,
  2026-08-08: *always sign in test accounts for review*). Half this app's
  surface is viewer-relative — the `own` flag shapes which controls exist, the
  tenant wall decides whether a subject 404s, capability tiers decide whether a
  composer renders at all, and `uiPrefs` scopes rail widths, folds and section
  facets per account. Swept from one account, every one of those cells is
  unreachable — and per §2's rule an unreachable cell is a **coverage
  violation**, never a skip. So sign in the demo roster
  ([docs/demo-accounts.md](../../../docs/demo-accounts.md)) and **stack** them
  (chip → *Add account…*) BEFORE the sweep, so switching is one click mid-cell:
  - **Ada** (`ada@acme.example`) — the flagship world; the OWNER's face.
  - **Grace** (`grace@acme.example`) — the second tenant a subject is shared
    WITH: the visitor's face of the same entity page.
  - **Maya** or **Rei** — a FOREIGN tenant, where the existence-hiding wall
    answers 404. Those 404s in the console are the wall working, not a bug.

  A change that touches nothing viewer-relative may sweep as one account —
  say so explicitly, per the no-silent-truncation rule above.
- List the matrix explicitly before sweeping, and say what you're *not*
  sweeping and why. Silent truncation reads as "covered everything".

## 2 · Sweep each cell mechanically

**Start with the checked-in harness**: `npm run ui:sweep`
([scripts/ui-sweep.mjs](../../../scripts/ui-sweep.mjs)) boots its **own**
isolated stack (dedicated ports, a wiped store — a shared dev world drifts
between runs) and drives the full surface × viewport matrix — every
`aria-haspopup` trigger opened and measured, h-scroll and inert checks per cell,
screenshots to `.data/ui-sweep/` — exiting nonzero on violations. Point it at a
running server with `UI_SWEEP_BASE=http://127.0.0.1:5173` when you specifically
want to sweep the app you are looking at.

Read the RESULT line's **cells-swept fraction**, not just the violation count.
An unreachable cell is a COVERAGE **violation**, never a skip: the harness once
reported "0 violations, 31 skips" over a narrow column it never navigated, and a
later revision died on an unguarded timeout at the first narrow viewport — a
stack trace and four unrun columns. Anything less than the full fraction means
the matrix has a hole; `skip` now covers only sub-checks inside a cell that did
run. For cells the harness doesn't model (new surfaces, tour states), sweep
manually per below.

Run the app (`preview_start`, dev config — never `vite preview`), sign the
roster in and stack it per §1, then per cell:

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
