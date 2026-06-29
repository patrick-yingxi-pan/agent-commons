# 02 · Context as attachment

> **Intent.** Capability is not a mode you enter; it's *context you attach*. A
> conversation gains tools because you attached the thing the tools act on — a
> folder, a repo, a connector, an MCP server, files, photos. Because everything
> attachable is "just context", one **Add context** entry point covers them all, and
> the attachment is the durable, server-owned record every effect is mediated
> against. Critically, the three filesystem types (**files / photos / folders**) are
> served from a **real filesystem**, from the three sources that exist in the system
> — never compile-time fixtures. (PROPOSAL §4.2; AGENTS "what's intentionally mock".)
>
> This pillar is where the "missing implementation" lived before — files/photos/
> folders were gradients and hand-authored bodies. The CTX-FS rows below are the
> requirements that make them real, so the gap can't recur silently.

## Attachment model (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| CTX-1 | One consistent "Add context" entry point opens a type picker; step two runs each type's own short workflow. The opener uses the shared inline-action primitive. | `src/components/AddContextButton.tsx`, `src/components/AddTrigger.tsx`, `src/lib/inlineAction.ts` | `tests/addTrigger.test.ts`; in-app (`src/components/AddContextButton.tsx`) | ✅ |
| CTX-2 | Exactly six context types exist: files, photos, folder, repo, connector, mcp. | `ContextTypeId` in `contract/contexts.ts` | `tests/session-contexts.test.ts` | ✅ |
| CTX-3 | Attaching/detaching is the *attachment of record*: a server-owned `SessionContext` (id, type, label, scope, optional source); broadcast on change. | `contract/contexts.ts`, `server/store.ts`, `server/routes/index.ts` | `tests/session-contexts.test.ts` | ✅ |
| CTX-4 | Recents are one non-evicting MRU id list per type, server-owned; fs-type ids are **source-qualified** (`sourceId::entryId`) via the shared key helper. | `server/store.ts`, `src/lib/recents.ts`, `fsRecentKey`/`parseFsRecentKey` in `contract/fs.ts`, `server/data/contextOptions.ts` | `tests/store.test.ts` | ✅ |
| CTX-5 | Set-up contexts (the Contexts page) — connectors / MCP / repos with auth status; connect/disconnect broadcasts `connector.status`. | `SavedContext` in `contract/contexts.ts`, `server/store.ts`, `server/data/savedContexts.ts` | `tests/routes-saved-contexts.test.ts` | ✅ |

## Files / photos / folders are really served (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| CTX-FS-1 | Files/photos/folders are served from a real filesystem via a shared reader (scan a root, scan a folder into artifacts, read text, read bytes) with a path-traversal guard — not fixtures. The three sources are modeled as `FsSource` (ui-host, runner, cloud). | `server/fs.ts`, `contract/fs.ts`, `src/lib/fsSources.ts` | `tests/fs-reader.test.ts`, `tests/routes-fs.test.ts` | ✅ |
| CTX-FS-2 | **Cloud source** — the web backend reads its own root and serves catalog / folder / text / bytes over the uniform `/fs/*?source=cloud` routes; available on **both** backends. | `server/store.ts`, `server/routes/index.ts`, `server/http/respond.ts`, `sample-cloud/` | `tests/routes-fs.test.ts` | ✅ |
| CTX-FS-3 | **Runner source** — a runner host is browsed via the broker (`fs.list` discovery) and read post-attach through the mediated, journaled `POST /runners/:id/invoke` (`fs.read` / `fs.list`); a broker bytes route proxies the runner for images; the runner's advertised scopes (D3) bound every read. | `server/runner-runtime.ts`, `server/data/runners.ts`, `server/routes/index.ts`, `sample-runner-host/` | `tests/runner-fs.test.ts` | ✅ |
| CTX-FS-4 | **UI-host source** — the machine the UI runs on is read **client-side** (browser File System Access API / `<input type=file>` / drag-drop); bytes stay in the browser until an effect uploads them. The one documented exception to "one door to the backend" (a web server cannot read the browser's disk). | `src/lib/uiHostFs.ts`, `src/components/AddContextButton.tsx` | in-app (`src/lib/uiHostFs.ts` — browser APIs; not exercisable headless) | ✅ |
| CTX-FS-5 | Real content renders: text files serve real text (edits track unsaved); images serve **real bytes** rendered via `<img>` through one shared thumbnail primitive (gradient only as load/error fallback); folders scan into real artifacts whose bodies are fetched on preview. | `src/components/AttachmentPanel.tsx`, `src/components/PhotoThumb.tsx`, `src/components/artifactPreview.tsx`, `src/api/hooks.ts` | `tests/routes-fs.test.ts`; in-app (`src/components/PhotoThumb.tsx`) | ✅ |
| CTX-FS-6 | Roots are deterministic, committed in-repo sample trees, env-overridable for real deployments (`CONTEXT_CLOUD_ROOT`, `CONTEXT_RUNNER_ROOT`). | `server/store.ts`, `server/data/runners.ts`, `sample-cloud/`, `sample-runner-host/` | `tests/routes-fs.test.ts`, `tests/runner-fs.test.ts` | ✅ |
| CTX-FS-7 | A runner id is validated to a safe slug at registration so it can't corrupt the `::`-delimited recents key (the source id stays delimiter-free). | `server/routes/index.ts`, `contract/fs.ts` | `tests/routes-agents.test.ts` | ✅ |
