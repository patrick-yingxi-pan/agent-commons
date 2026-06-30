# P1 · Adaptive conversation UI

> **Pillar.** The production UI for the one adaptive conversation — closing the
> forward-looking gaps ([spec FWD-1/2/3](../spec/10-forward-looking.md)) and adding the
> accessibility, performance, and offline robustness a shipped client needs. Builds on
> [F3](F3-contract-sync.md) (sync) and [F2](F2-identity-tenancy.md) (identity).

## 1. Problem & scope

The prototype's adaptive shell is the thesis made real (ADAPT-1..9): no mode chosen up
front, the right panel morphs as context attaches (`src/controller/useLayout.ts`,
`useSessionWorkspace.ts`, `src/components/PanelShell.tsx`). Production must close the
known UI gaps and harden for real use. **Shared** across both deployments (the UI is
byte-identical; only the backend behind `client.ts` differs).

## 2. Design

### 2.1 Pre-attached entry points (FWD-1)

The old per-mode entries survive as **shortcuts that pre-attach context**, not tabs.
`newSession` (`src/controller/useSessionWorkspace.ts`) gains an optional **context
seed**: "New from repo" / "New from folder" creates a thread and attaches that context
on creation (running the same attach funnel), landing already-escalated; "New chat" is
the seed-less case. One code path, several launchers — consistent with the
one-door/one-funnel invariants.

### 2.2 Per-conversation panel state (FWD-2)

Today `strongestFocus` re-derives the panel on every open; production **persists the
per-session panel choice** (open/closed, which panel, width). Store it as **user
preferences server-side** (a small `ui_prefs` keyed by `(user, session)`) so it syncs
across devices (the multi-device payoff of server-owned state, F3); `strongestFocus`
remains the default when no stored choice exists. Falls back to `localStorage` on the
desktop/offline.

### 2.3 Responsive ladder (FWD-3)

A viewport-driven ladder replaces the fixed-width assumption (`PanelShell.tsx` clamps
but never collapses):

| Width | Layout |
|-------|--------|
| **Wide** | Left rail + thread + right panel side-by-side (today's layout). |
| **Medium** | Right panel **overlays** the thread (drawer) instead of squeezing it. |
| **Narrow** | Right panel collapses to a **rail** (icon strip); tapping expands it as a full-width drawer; the left rail collapses too (already supported). |

Driven by a `useViewport` hook + CSS breakpoints (the prototype has zero media queries
in `src/index.css` today). Panel width stays user-resizable within each tier.

### 2.4 Accessibility

Keyboard-first (the prototype already has `useFocusTrap` / `useDismissable`): full tab
order, focus moved into a panel on open and restored on close, ARIA landmarks
(nav/main/complementary), `aria-live` for streaming assistant text + run/relation
updates, visible focus rings, `prefers-reduced-motion` honored (the framer-motion
transitions), and WCAG-AA contrast (light-theme only, INV-1). Target WCAG 2.2 AA.

### 2.5 Performance

- **History virtualization** — windowed message list so a long thread renders a
  bounded number of nodes; back-pages via cursor pagination (F3 PD14), newest-first.
- **Lazy content** — panel bodies + images load on demand (image lazy-loading already
  in `PhotoThumb`); artifact bodies fetched per-open, cached.
- **Optimistic writes** — the cache already supports optimistic updates; reconcile on
  the server echo, roll back on error.

### 2.6 Offline & error states

SSE reconnect + epoch reset already exist (`src/api/events.ts`); production adds an
**offline indicator**, queued optimistic writes that flush on reconnect (desktop is
fully offline-capable; web degrades gracefully), and per-query loading/error surfaces
(the cache's `QueryState`). A failed mutation rolls back the optimistic state and
surfaces a retry.

## 3. Failure modes & edge cases

- **Very long thread** — virtualization + pagination bound memory; jump-to-latest.
- **Tiny viewport** — the narrow tier keeps the thread usable; the panel is a drawer.
- **Slow content** — skeletons (the prototype already shows loading states); never a
  layout jump (reserve space).
- **Stale optimistic state** — server echo reconciles; conflict (409) → re-read.
- **Reduced motion / high contrast / zoom** — honored; no information conveyed by color
  alone.

## 4. Security & multi-tenancy

The UI makes **no authorization decisions** — it renders what the tenant-scoped API
returns; affordances may be pre-hidden off `Capabilities` flags but the server is the
gate (the prototype's stance). Rendered content is sanitized (markdown; SVG only via
`<img>`, which can't execute — already the CTX-FS posture). Identity from `/v1/me` (F2).

## 5. Observability & ops

Client telemetry: Core Web Vitals, JS error reporting (tenant-tagged), SSE
connection health from the client side, interaction funnels (escalation accept/decline,
attach completion). Feature flags gate UI rollout (F3 PD17).

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD33** (`newSession` takes an optional context
seed; per-mode entries become pre-attach shortcuts — FWD-1), **PD34** (per-conversation
panel state persisted as server-side user prefs, syncing across devices; `localStorage`
fallback — FWD-2), **PD35** (responsive wide/medium/narrow ladder with a right-panel rail
— FWD-3), **PD36** (history virtualization + cursor pagination), **PD37** (WCAG 2.2 AA
baseline: keyboard/ARIA/live-regions/reduced-motion/contrast).
