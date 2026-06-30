# 10 · Forward-looking — required but not (fully) built

> **Intent.** This is the pillar that makes the spec a *gap-finder* rather than a
> code inventory. The other pillars were largely derived from the implementation, so
> they skew to ✅. This one is derived **top-down from the goal** — the proposal's
> migration sketch (§7) and open questions (§8) imply requirements the prototype does
> **not** yet satisfy. Listing them with honest `📝 planned` / `🟡 partial` status is
> what lets "find the unimplemented features" return an answer: they're the rows here.
> When one is built, move its row into the owning pillar as ✅ with a locking test.
>
> Found by the top-down audit (`docs/spec/` did not list these before); see the
> Known gaps callout in [`README.md`](README.md).

## Requirements (L2)

| ID | Requirement | Anchor / where it would live | Status |
|----|-------------|------------------------------|--------|
| FWD-1 | "New Code session" / "New Cowork project" entry points that start a conversation with context **pre-attached** (a repo / a workspace), so the old per-mode entry points survive as shortcuts, not tabs (PROPOSAL §7). **Built:** `newSession(seed?)` takes a context seed and a fresh thread lands already-escalated with that context + its panel (the `EmptyState` "Start with a repo, folder, or connector…" launcher reuses the attach funnel); draft-attached contexts now persist on materialize (`pendingDraftContexts`). UI-verified in-app. **Remaining:** dedicated per-mode launchers in the sidebar. | `src/controller/useSessionWorkspace.ts` (`newSession`/`newSessionWith`), `src/App.tsx` (`EmptyState`), `src/components/AddContextButton.tsx` | 🟡 |
| FWD-2 | The right panel's expansion is **remembered per-conversation** (PROPOSAL §7). **Built:** the per-session open/closed/which-panel choice persists across reloads + session switches (`src/lib/panelPrefs.ts`, restored in `selectSession`, written on the explicit panel actions); `strongestFocus` stays the default when there's no stored choice. UI-verified in-app + the store logic unit-tested. **Remaining:** the canonical server-side cross-device `ui_prefs` (localStorage is its documented fallback); panel *width* memory. | `src/lib/panelPrefs.ts`, `src/controller/useSessionWorkspace.ts` | 🟡 |
| FWD-3 | Responsive panel rules: on a narrow window, the right panel adapts rather than crushing the thread (PROPOSAL §8 open question). **Built:** a `useViewport` tier (wide ≥1024 / medium ≥640 / narrow); below wide the right panel **overlays the thread as a drawer + dismiss-on-click scrim** instead of squeezing it. UI-verified across tiers. **Remaining:** the narrow icon-rail and the left-rail drawer on narrow. | `src/lib/viewport.ts`, `src/App.tsx`, `src/components/PanelShell.tsx` | 🟡 |
| FWD-4 | Cross-device sync of the server-owned state (PROPOSAL §10 "persists and could sync across devices"). The foundation is built (state is server-owned + persisted + pushed over SSE); multi-device fan-out / conflict handling is not. | `server/persist.ts`, `server/store.ts`, `src/api/events.ts` | 🟡 |
