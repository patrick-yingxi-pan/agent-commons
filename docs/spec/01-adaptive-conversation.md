# 01 · Single adaptive conversation

> **Intent.** There is no mode to pick. Every interaction begins as one thread with
> one composer; the right-hand panel is absent until context attaches, then opens
> and *morphs* to fit what's attached; there is one unified history; and the
> functions that span conversations (Projects, Artifacts, Scheduled, …) live in the
> sidebar as **tools, not tabs**. Collapsing Chat/Cowork/Code into this one surface
> is the entire thesis — so the UI must never re-introduce a mode switcher.
> (PROPOSAL §4.1, §4.3, §4.5, §4.6.)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| ADAPT-1 | App opens to a single empty thread + composer — no Chat/Cowork/Code switcher anywhere in the chrome. | `src/App.tsx`, `src/components/Composer.tsx`, `src/components/Sidebar.tsx` | in-app (`src/App.tsx`); nav has no mode tabs — `tests/nav.test.ts` | ✅ |
| ADAPT-2 | The right panel is absent in plain chat and opens automatically as context attaches, morphing artifacts → code (editor/diff/terminal) as the focus changes. | `src/controller/useLayout.ts`, `src/components/WorkspacePanel.tsx`, `src/components/panels/ArtifactPanel.tsx`, `src/components/panels/CodePanel.tsx`, `src/components/PanelShell.tsx` | in-app (`src/components/WorkspacePanel.tsx`) | ✅ |
| ADAPT-3 | Every context chip above the composer opens — or, if already open, closes — that context's panel; only one panel shows at a time and the active chip is highlighted. | `src/components/Composer.tsx`, `src/controller/useSessionWorkspace.ts`, `PanelFocus` in `contract/entities.ts` | in-app (`src/components/Composer.tsx`) | ✅ |
| ADAPT-4 | A context *type* holding more than one item collapses into one counted chip whose popup lists items; each row removes with a confirm that can be muted ("Don't ask again"). | `src/components/Composer.tsx`, `src/components/AttachmentPanel.tsx`, `src/lib/prefs.ts` | in-app (`src/components/Composer.tsx`) | ✅ |
| ADAPT-5 | One unified history: one compact row per conversation, searchable in one place; a conversation's capabilities travel with it (its chips + panel). | `src/components/Sidebar.tsx`, `src/components/SearchPanel.tsx`, `src/lib/sessionFilter.ts` | `tests/sidebar.test.ts`, `tests/routes-sessions.test.ts` | ✅ |
| ADAPT-6 | Cross-cutting functions (Projects, Artifacts, Contexts, Agents, Scheduled, Dispatch, Customize) are sidebar *tools*, not modes — opening one takes over the main area in place of the thread. | `src/lib/nav.ts`, `src/lib/sections.tsx`, `src/components/SectionView.tsx`, `SectionId` in `contract/entities.ts` | `tests/nav.test.ts`, `tests/sections.test.ts` | ✅ |
| ADAPT-7 | Capability is an attribute of a conversation (`chat` / `workspace` / `repo`), held all at once — not a category of app. | `Capability` in `contract/entities.ts`, `src/controller/useSessionWorkspace.ts` | `tests/routes-workspace.test.ts` | ✅ |
| ADAPT-8 | **Dispatch** — a cross-cutting tool: one-off background agent runs that land `running` and finish a beat later, shown in a live feed. Runs are **persisted** (P7 durability): a live run survives a restart, and one interrupted mid-flight is swept to `failed` on rehydrate. Run counts by status are exposed as a `dispatch_runs` gauge in `/metrics` (F6 observability). | `contract/cowork.ts`, `server/routes/index.ts` (`/dispatch`, `/metrics`), `server/store.ts`, `src/components/RunsPanel.tsx` | `tests/routes-dispatch.test.ts`, `tests/dispatch-durability.test.ts`, `tests/metrics.test.ts` | ✅ |
| ADAPT-9 | **Scheduled** — recurring routines on a cadence, seeded from starter templates (`/schedule-templates`); run-now + the daemon append runs to one live feed. | `contract/cowork.ts`, `server/routes/index.ts` (`/schedules`, `/schedule-templates`), `src/components/SectionView.tsx` | `tests/routes-schedules.test.ts` | ✅ |
