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
| FWD-1 | "New Code session" / "New Cowork project" entry points that start a conversation with context **pre-attached** (a repo / a workspace), so the old per-mode entry points survive as shortcuts, not tabs (PROPOSAL §7). Today only a generic blank "New session" exists. | `src/controller/useSessionWorkspace.ts` (the `newSession` seam), `src/components/Sidebar.tsx` | 📝 |
| FWD-2 | The right panel's expansion is **remembered per-conversation** (PROPOSAL §7). The auto-open of the strongest context is built (`strongestFocus`); what's missing is persisting a per-session open/closed/which-panel choice across reloads + session switches. | `src/controller/useSessionWorkspace.ts`, `src/controller/useLayout.ts`, `server/persist.ts` | 🟡 |
| FWD-3 | Responsive panel rules: on a narrow window, the right panel auto-collapses to a rail (PROPOSAL §8 open question). Today widths are clamped but there is no viewport-driven collapse and no media queries. | `src/components/PanelShell.tsx`, `src/controller/useLayout.ts`, `src/index.css` | 📝 |
| FWD-4 | Cross-device sync of the server-owned state (PROPOSAL §10 "persists and could sync across devices"). The foundation is built (state is server-owned + persisted + pushed over SSE); multi-device fan-out / conflict handling is not. | `server/persist.ts`, `server/store.ts`, `src/api/events.ts` | 🟡 |
