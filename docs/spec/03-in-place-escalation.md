# 03 · In-place escalation

> **Intent.** The defining move: a plain chat can **level up into a workspace, then
> into a repo, in the same thread**, carrying all prior context, with no tab switch
> and nothing re-explained. Each escalation is the *result of a model tool call*
> (`open_workspace` / `connect_repo` / `create_project`) executed by the backend and
> surfaced as a **consent-gated proposal** — panels attach only on the user's
> approval. The guided tour is exactly this, and it's a real round-trip, so the
> panels' content is a tool's output, not a client fixture. (PROPOSAL §4.4; AGENTS
> "no real model — but the whole pipeline is real".)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| ESC-1 | One thread escalates chat → workspace → repo (→ organize) carrying prior context; the guided tour drives exactly this sequence. | `src/data/demo.ts`, `src/components/IntroOverlay.tsx`, `server/model/intents.ts` | `tests/tour-script.test.ts`; in-app (`src/components/IntroOverlay.tsx`) | ✅ |
| ESC-2 | An escalation is the structured result of a model tool call (`open_workspace`/`connect_repo`/`create_project`), carried as `EscalationProposal` on `message.escalation`. | `server/model/tools.ts`, `server/generate.ts`, `EscalationProposal` in `contract/entities.ts`, `MessageEscalationEvent` in `contract/events.ts` | `tests/model-tools.test.ts`, `tests/routes-messages.test.ts` | ✅ |
| ESC-3 | An escalation is consent-gated: the panels attach (or the project is created) only on approval; a denial is recoverable. | `src/components/TourPermissionPrompt.tsx`, `src/controller/useSessionWorkspace.ts` | in-app (`src/components/TourPermissionPrompt.tsx`) | ✅ |
| ESC-4 | The tour is a real round-trip (UI → backend → mock model → back); escalation payloads come from executing the model's tool calls, not from a client fixture. | `server/generate.ts`, `server/model/index.ts`, `server/model/replies.ts` | `tests/generate.test.ts`, `tests/model-server.test.ts` | ✅ |
| ESC-5 | The panel morphs to match the escalation — artifacts for a workspace, code/diff/terminal for a repo. | `src/components/WorkspacePanel.tsx`, `src/components/panels/CodePanel.tsx` | in-app (`src/components/WorkspacePanel.tsx`) | ✅ |
