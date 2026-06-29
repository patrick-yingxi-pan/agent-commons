# 04 · Consent & the relationship graph

> **Intent.** The surface models five things — a **session**, a **project**, an
> **artifact**, a **context**, a **schedule** — and every pair relates (ten edges).
> Those edges live in **one shared relation graph**, and the only way to change them
> is **with the user's consent**: Claude proposes a relation edit as an inline
> confirmation card and *nothing changes until you confirm*. Two consent shapes:
> **per-action** (a one-off edit, confirmed each time) and **standing** (a schedule
> is approved once, in advance, then runs unprompted on its cadence). The same gate
> governs everything Claude changes, including the Agent Commons registries.
> (PROPOSAL §4.7, §6.6.)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| REL-1 | The five entities and all ten pairwise relations are modeled in one shared, server-owned relation graph. | `RelationGraph` in `contract/api.ts`, `contract/relations.ts`, `seedGraph` in `contract/graph.ts` | `tests/shared-reducer.test.ts` | ✅ |
| REL-2 | Relation edits are proposed inline (a card under Claude's message) and applied **only** on confirm; nothing changes until then. | `src/components/RelationActionCard.tsx`, `src/components/ProposalBar.tsx`, `src/controller/useRelations.tsx`, `MessageRelationsEvent` in `contract/events.ts` | `tests/routes-relations-commons.test.ts`; in-app (`src/components/RelationActionCard.tsx`) | ✅ |
| REL-3 | One pure reducer runs on both ends (type-identity), so a confirmed op lands identically in the UI cache and the server graph. | `applyGraphOp` in `contract/graph.ts`, `server/store.ts`, `src/controller/useRelations.tsx` | `tests/shared-reducer.test.ts` | ✅ |
| REL-4 | Standing approval: a schedule is the unit of advance approval; approving once pre-authorizes each run's effects, applied unprompted on cadence and broadcast `by: 'standing'`. | `server/store.ts`, `standingApprovals` in `RelationGraph` (`contract/api.ts`), `RelationAppliedEvent` in `contract/events.ts` | `tests/store-runs.test.ts` | ✅ |
| REL-5 | Created projects live in the relation graph (`extraProjects` via a create-project op), not in a separate store. | `RelationGraph` in `contract/api.ts`, `contract/graph.ts`, `server/store.ts` | `tests/shared-reducer.test.ts` | ✅ |
| REL-6 | One gate for everything Claude changes: the Agent Commons concepts (providers, prompts, worker agents, commissions) are editable by hand (hub) **and** conversationally through the *same* confirm card. | `server/model/tools.ts`, `src/components/RelationActionCard.tsx`, `src/api/commonsInvalidation.ts` | `tests/routes-relations-commons.test.ts` | ✅ |
| REL-7 | A confirmed edit propagates to every view that draws the relationship (Projects, Artifacts, Scheduled) because they all read the one graph. | `src/components/SectionView.tsx`, `src/lib/projectContext.ts`, `src/controller/useRelations.tsx` | `tests/project-context.test.ts` | ✅ |
