# 02 · Context as attachment

> **Intent.** Capability is not a mode you enter; it's *context you attach*. A
> conversation gains tools because you attached the thing the tools act on — a
> folder, a repo, a connector, an MCP server, files, photos. Because everything
> attachable is "just context", one **Add context** entry point covers them all, and
> the attachment is the durable, server-owned record every effect is mediated
> against. Critically, the three filesystem types (**files / photos / folders**) are
> served from a **real filesystem**, from the three sources that exist in the system
> — never compile-time fixtures. The complete fixture boundary is recorded in
> [`11-mock-boundary.md`](11-mock-boundary.md).
>
> This pillar is where the "missing implementation" lived before — files/photos/
> folders were gradients and hand-authored bodies. The CTX-FS rows below are the
> requirements that make them real, so the gap can't recur silently.

## Attachment model (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| CTX-1 | One consistent "Add context" entry point opens a type picker; step two runs each type's own short workflow. The opener uses the shared inline-action primitive. | `src/components/AddContextButton.tsx`, `src/components/AddTrigger.tsx`, `src/lib/inlineAction.ts` | `src/lib/addTrigger.test.ts`; in-app (`src/components/AddContextButton.tsx`) | ✅ |
| CTX-2 | Exactly six context types exist: files, photos, folder, repo, connector, mcp. | `ContextTypeId` in `contract/contexts.ts` | `server/routes/session-contexts.test.ts` | ✅ |
| CTX-3 | Attaching/detaching is the *attachment of record*: a server-owned `SessionContext` (id, type, label, scope, optional source). Its effect-mediation bindings and visible `SessionWorkspace` commit through one idempotent `PATCH /sessions/:id/context-state` transaction and broadcast together; the client serializes per session, acknowledgment-gates the panel, surfaces an accessible Retry on failure, and a draft reuses its already-created session when that transaction must retry. The three former partial mutation doors are retired. Removing a merged workspace detaches every contributing source-folder id, not the shared panel id alone. | `contract/api.ts`, `server/store/index.ts`, `server/routes/index.ts`, `src/controller/contextMutationsCore.ts`, `src/controller/useSessionContextCommands.ts`, `src/controller/draftCore.ts` | `server/routes/session-contexts.test.ts`, `src/controller/context-mutations.test.ts`, `src/controller/draft-core.test.ts`, `src/data/focusForAdded.test.ts`, `e2e/context-mutations.spec.ts` | ✅ |
| CTX-4 | Recents are one non-evicting MRU id list per type, server-owned; fs-type ids are **source-qualified** (`sourceId::entryId`) via the shared key helper. | `server/store/index.ts`, `src/lib/recents.ts`, `fsRecentKey`/`parseFsRecentKey` in `contract/fs.ts`, `server/data/contextOptions.ts` | `server/store/index.test.ts` | ✅ |
| CTX-5 | Set-up contexts (the Contexts page) — connectors / MCP / repos with auth status; connect/disconnect broadcasts `connector.status`. The page's **Add / Remove are server-owned too** (`POST`/`DELETE /saved-contexts`, broadcasting `savedcontext.changed`) — they once lived in component state and evaporated on unmount — and the composer's Add-context "Connected" quick list reads each row's auth dot from this same registry, never asserting it (a disconnect shows everywhere). | `SavedContext` in `contract/contexts.ts`, `contract/events.ts` (`SavedContextChangedEvent`), `server/store/index.ts` (`addSavedContext`/`removeSavedContext`), `server/data/savedContexts.ts`, `src/components/AddContextButton.tsx` (registry-joined quick list) | `server/routes/saved-contexts.test.ts`, `server/store/event-tenancy.test.ts`, `src/api/connectivity-freshness.test.ts` | ✅ |

## Files / photos / folders are really served (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| CTX-FS-1 | Files/photos/folders are served from a real filesystem via a shared reader (scan a root, scan a folder into artifacts, read text, read bytes) with a path-traversal guard — not fixtures. The three sources are modeled as `FsSource` (ui-host, runner, cloud). | `server/fs.ts`, `contract/fs.ts`, `src/lib/fsSources.ts` | `server/fs-reader.test.ts`, `server/routes/fs.test.ts` | ✅ |
| CTX-FS-2 | **Cloud source** — the web backend reads its own root and serves catalog / folder / text / bytes over the uniform `/fs/*?source=cloud` routes; available on **both** backends. | `server/store/index.ts`, `server/routes/index.ts`, `server/http/respond.ts`, `sample-cloud/` | `server/routes/fs.test.ts` | ✅ |
| CTX-FS-3 | **Runner source** — a runner host is browsed via the broker (`fs.list` discovery) and read post-attach through the mediated, journaled `POST /runners/:id/invoke` (`fs.read` / `fs.list`); a broker bytes route proxies the runner for images; the runner's advertised scopes (D3) bound every read. | `server/runner-runtime.ts`, `server/data/runners.ts`, `server/routes/index.ts`, `sample-runner-host/` | `server/routes/runner-fs.test.ts` | ✅ |
| CTX-FS-4 | **UI-host source** — the machine the UI runs on is read **client-side**: web uses `<input type=file>` / drag-drop, while Electron swaps user-mediated file/folder dialogs behind the same adapter. Its sender-validated bridge returns only names, sizes, bounded text/image previews, and top-level regular folder entries—never an absolute path, reusable handle, recursive read, or raw IPC. Cancellation is a no-op; limit/read failures remain in the picker with actionable copy. Bytes stay renderer-side until an effect uploads them. This is the documented exception to “one door to the backend” (a web server cannot read the browser's disk). | `desktop/contextPicker.mjs`, `desktop/preload.cjs`, `desktop/main.mjs`, `src/lib/uiHostFs.ts`, `src/components/AddContextButton.tsx` | `desktop/contextPicker.test.ts`; `src/lib/ui-host-fs.test.ts`; `e2e/desktop-context-picker.spec.ts`; packaged smoke | ✅ |
| CTX-FS-5 | Real content renders: text files serve real text (edits track unsaved); images serve **real bytes** rendered via `<img>` through one shared thumbnail primitive (gradient only as load/error fallback); folders scan into real artifacts whose bodies are fetched on preview. | `src/components/AttachmentPanel.tsx`, `src/components/PhotoThumb.tsx`, `src/components/artifactPreview.tsx`, `src/api/hooks.ts` | `server/routes/fs.test.ts`; in-app (`src/components/PhotoThumb.tsx`) | ✅ |
| CTX-FS-6 | Roots are deterministic, committed in-repo sample trees, env-overridable for real deployments (`CONTEXT_CLOUD_ROOT`, `CONTEXT_RUNNER_ROOT`). | `server/store/index.ts`, `server/data/runners.ts`, `sample-cloud/`, `sample-runner-host/` | `server/routes/fs.test.ts`, `server/routes/runner-fs.test.ts` | ✅ |
| CTX-FS-7 | A runner id is validated to a safe slug at registration so it can't corrupt the `::`-delimited recents key (the source id stays delimiter-free). | `server/routes/index.ts`, `contract/fs.ts` | `server/routes/agents.test.ts` | ✅ |
