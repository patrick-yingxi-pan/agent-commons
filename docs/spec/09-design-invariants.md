# 09 · Design invariants

> **Intent.** A handful of decisions are locked in — they shape every change and must
> not silently drift. Some are *form-follows-function* rules (logically parallel
> controls share one styled primitive, so a cue can't diverge between copies) and are
> each guarded by a dedicated test; others (light-theme-only, the IPv4 bind) are
> guarded structurally by the conformance test; a couple are review-enforced
> conventions, marked as such so the absence of an automated guard is explicit rather
> than assumed. (AGENTS "Design decisions (locked in)".)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| INV-1 | Light theme only — no dark mode, no theme toggle, no `dark:` variants. | `src/index.css` | `tests/spec-conformance.test.ts` (no `dark:` in `src`) | ✅ |
| INV-2 | No "before" view — the prototype does not reproduce today's three-tab UI; the motivation lives in docs + tour captions. | (absence by design) | review-enforced convention (no automated guard) | 🟡 |
| INV-3 | The dev server binds IPv4 (`127.0.0.1`) for both the UI and the API proxy. | `vite.config.ts`, `scripts/dev.mjs` | `tests/spec-conformance.test.ts` (`127.0.0.1` in `vite.config.ts`) | ✅ |
| INV-4 | Form follows function: every "+ Add ‹thing›" picker-opener shares one primitive, and every foldable section header shares one. | `src/lib/inlineAction.ts`, `src/components/AddTrigger.tsx`, `src/lib/foldHeader.ts` | `tests/addTrigger.test.ts`, `tests/foldHeader.test.ts` | ✅ |
| INV-5 | Every popover / dropdown / menu dismisses on outside-click + Escape through one shared hook. | `src/lib/useDismissable.ts` | `tests/useDismissable.test.ts` | ✅ |
| INV-6 | One door to the backend: the UI reads through `src/api` hooks and writes through commands; nothing else knows a URL or SSE event. The single documented exception is the UI-host filesystem source (client-owned by nature — see CTX-FS-4). | `src/api/client.ts`, `src/api/hooks.ts`, `src/api/commands.ts`, `src/api/events.ts` | `tests/contract-boundaries.test.ts` | ✅ |
| INV-7 | Few runtime dependencies: the server carries one intentional dependency (`@anthropic-ai/sdk`); the rest of `server/` is dependency-free (hand-rolled Node types). | `package.json`, `server/node.d.ts` | `tests/contract-boundaries.test.ts`; review (`package.json`) | ✅ |
| INV-8 | The contract is erasable, framework-free and Node-free TypeScript (no enums / namespaces / parameter properties). | `contract/index.ts` | `tests/contract-boundaries.test.ts` | ✅ |
