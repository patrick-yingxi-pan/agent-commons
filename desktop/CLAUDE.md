<!-- context-schema: v1 -->
# desktop/ — Electron shell context

## Scope

Owns the near-term native application shell. Product behavior remains in the
shared UI/server contract; the shell owns only process lifecycle, trusted-window
policy, OS user-data placement, user-mediated native selection, the OS-encrypted
provider-credential adapter, the MCP credential vault/IPC lifecycle, and packaging.
MCP inspection and per-call approved execution use the shared backend. Combined
real-service/native execution acceptance remains a separate release gate.

## Read path

Read [`../server/CLAUDE.md`](../server/CLAUDE.md) when changing the supervised
runtime profile or utility-process contract, and [`../src/CLAUDE.md`](../src/CLAUDE.md)
when changing the renderer-facing bridge or setup UI.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| DESKTOP-A1 | architecture | Electron is a replaceable local host: it runs the existing desktop runtime profile and loads the unchanged HTTP/SSE UI, never importing product state into the renderer. | [`main.mjs`](main.mjs) · [`../scripts/start.mjs`](../scripts/start.mjs) | [`runtime.test.ts`](runtime.test.ts) | refines ROOT-A2 |
| DESKTOP-S1 | data-access | The renderer is sandboxed and unprivileged; exact loopback navigation, new windows, external schemes, permissions, and device access fail closed. | [`main.mjs`](main.mjs) · [`runtime.mjs`](runtime.mjs) | [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-A1 |
| DESKTOP-S2 | data-access | Provider keys are encrypted through OS-backed safe storage, never enter HTTP or product persistence, and cross the sandbox through a sender-validated write-lifecycle bridge with no read/list/raw-IPC authority. Linux `basic_text` and unknown backends fail closed; one provider retains one active device key, while connection revision/idempotency and acknowledgement-aware cleanup ensure uncertain rotation reuses the exact provisional key. Removal erases only after server acknowledgement, keeps failure visible and independently retryable, and retains restart reconciliation as its disclosed fallback. | [`credentialVault.mjs`](credentialVault.mjs) · [`credentialProtocol.mjs`](credentialProtocol.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../src/controller/providerConnectionCore.ts`](../src/controller/providerConnectionCore.ts) · [`../src/controller/providerConnectionMutationRuntime.ts`](../src/controller/providerConnectionMutationRuntime.ts) · [`../src/controller/providerDeletionMutationRuntime.ts`](../src/controller/providerDeletionMutationRuntime.ts) | [`credentialVault.test.ts`](credentialVault.test.ts) · [`credentialProtocol.test.ts`](credentialProtocol.test.ts) · [`../src/controller/provider-connection.test.ts`](../src/controller/provider-connection.test.ts) · [`../e2e/provider-deletion.spec.ts`](../e2e/provider-deletion.spec.ts) · [`runtime.test.ts`](runtime.test.ts) · packaged smoke | requires DESKTOP-S1; refines ROOT-D1 |
| DESKTOP-S3 | data-access | Native context access is one-shot and user-mediated: exact-origin/window-validated IPC opens only file or folder dialogs, returns names plus bounded preview/metadata payloads, imports visible regular top-level folder text snapshots through the shared 64 KiB/file, 128 KiB/import, 24-readable-file policy, and imports direct PDF/DOCX/XLSX bytes only as transient path-free payloads for renderer workers under their declared file/selection/archive/XML/text limits. It never exposes an absolute path, reusable handle, recursive read, raw IPC authority, or archive bytes to product state. Text intake shares the browser's supported-format registry and strict whole UTF-8 decoder. | [`contextPicker.mjs`](contextPicker.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../contract/localTextFile.mjs`](../contract/localTextFile.mjs) · [`../contract/pdfImport.mjs`](../contract/pdfImport.mjs) · [`../contract/docxImport.mjs`](../contract/docxImport.mjs) · [`../src/lib/uiHostFs.ts`](../src/lib/uiHostFs.ts) | [`contextPicker.test.ts`](contextPicker.test.ts) · [`runtime.test.ts`](runtime.test.ts) · [`../src/lib/ui-host-fs.test.ts`](../src/lib/ui-host-fs.test.ts) · [`../e2e/desktop-context-picker.spec.ts`](../e2e/desktop-context-picker.spec.ts) · packaged PDF/DOCX/XLSX smoke | requires DESKTOP-S1; requires CONTRACT-D75; requires CONTRACT-D79; refines ROOT-D1 |
| DESKTOP-S4 | data-access | Provider creation treats an OS-encrypted key as provisional until the exact durable provider is acknowledged: one reference is reused across safe Retry, bound only after acknowledgement or exact reconciliation, discarded only when authoritative non-application is known with no uncertain submission, and otherwise left for startup binding reconciliation rather than risking a committed provider with a deleted key. An `uncertainSubmission` on the frozen intent means cleanup never deletes that key, even after a later definitive refusal. The activation identity is rechecked after native provisioning and before provider HTTP work; a source switch before submission discards only that exact unused provisional reference, while post-submission uncertainty retains it. | [`../src/controller/providerCreationCredentialCore.ts`](../src/controller/providerCreationCredentialCore.ts) · [`../src/controller/providerCreationMutations.ts`](../src/controller/providerCreationMutations.ts) · [`credentialProtocol.mjs`](credentialProtocol.mjs) · [`../scripts/start.mjs`](../scripts/start.mjs) | [`../src/controller/provider-creation-credential.test.ts`](../src/controller/provider-creation-credential.test.ts) · [`../src/controller/provider-creation.test.ts`](../src/controller/provider-creation.test.ts) · [`../e2e/desktop-provider-setup.spec.ts`](../e2e/desktop-provider-setup.spec.ts) · [`runtime.test.ts`](runtime.test.ts) · packaged smoke | requires DESKTOP-S2; requires STORE-D31 |
| DESKTOP-S5 | data-access | A private OS-encrypted device authentication root is durably published before backend launch and reused across relaunch. Only absence creates it; unavailable/insecure storage, invalid or symlinked files, and decryption failure stop startup without rotation or database restore. Cookie and token expiry/revocation still apply; the root never enters provider cleanup, renderer IPC, or portable backups. | [`authRoot.mjs`](authRoot.mjs) · [`main.mjs`](main.mjs) | [`authRoot.test.ts`](authRoot.test.ts) · [`runtime.test.ts`](runtime.test.ts) · packaged restart smoke | requires DESKTOP-S1; requires DESKTOP-O1; refines ROOT-D1 |
| DESKTOP-S6 | data-access | Native image intake remains one-shot and user-mediated through the existing trusted picker bridge: real selected bytes are structurally bounded at 8 MiB, raster-normalized to a first-frame PNG at ≤2,000 px edge and ≤3 MiB, uploaded as a durable tenant-scoped reference, and delivered as first-class model image blocks. Packaged image smoke proves native bytes, IPC, persistence, relaunch without the source, and detach; manual OS-dialog review, signing, and paid-provider acceptance remain separate gates. | [`contextPicker.mjs`](contextPicker.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../src/lib/imageImport.ts`](../src/lib/imageImport.ts) · [`../src/lib/uiHostFs.ts`](../src/lib/uiHostFs.ts) | [`contextPicker.test.ts`](contextPicker.test.ts) · [`runtime.test.ts`](runtime.test.ts) · [`../src/lib/image-import.test.ts`](../src/lib/image-import.test.ts) · packaged image smoke | requires DESKTOP-S3; requires CONTRACT-D78; refines ROOT-D1 |
| DESKTOP-S7 | data-access | MCP secrets cross only a provision-only trusted renderer bridge and bounded exact-audience child resolution. OS-encrypted bindings synchronize after durable rehydration before admission; one native disk queue outlives IPC timeouts, later snapshots retire only prior authoritative references, and failed cleanup retains exact retry state without erasing unrelated provisional credentials. | [`main.mjs`](main.mjs) · [`preload.cjs`](preload.cjs) · [`mcpCredentialVault.mjs`](mcpCredentialVault.mjs) · [`mcpCredentialProtocol.mjs`](mcpCredentialProtocol.mjs) · [`mcpCredentialLifecycle.mjs`](mcpCredentialLifecycle.mjs) | [`mcpCredentialVault.test.ts`](mcpCredentialVault.test.ts) · [`mcpCredentialProtocol.test.ts`](mcpCredentialProtocol.test.ts) · [`mcpCredentialLifecycle.test.ts`](mcpCredentialLifecycle.test.ts) · [`runtime.test.ts`](runtime.test.ts) · packaged MCP smoke | requires DESKTOP-S1; refines ROOT-D1 |
| DESKTOP-S8 | data-access | Native XLSX selection is one-shot and user-mediated through the existing trusted picker bridge: selected `.xlsx` bytes are transient, bounded at 8 MiB/file and 24 MiB/selection, and handed to the renderer document worker only as path-free bytes/status. The native process never imports the XLSX parser, exposes a path or reusable handle, persists archive bytes, evaluates formulas, or broadens the existing PDF/DOCX/document selection policy. | [`contextPicker.mjs`](contextPicker.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../contract/xlsxImport.mjs`](../contract/xlsxImport.mjs) · [`../src/lib/uiHostFs.ts`](../src/lib/uiHostFs.ts) | [`contextPicker.test.ts`](contextPicker.test.ts) · [`../src/lib/ui-host-fs.test.ts`](../src/lib/ui-host-fs.test.ts) · packaged XLSX smoke | requires DESKTOP-S3; requires CONTRACT-D81; refines ROOT-D1 |
| DESKTOP-S9 | data-access | Native PPTX selection is one-shot and user-mediated through the existing trusted picker bridge: selected `.pptx` bytes are transient, bounded at 8 MiB/file and 24 MiB/selection, and handed to the renderer document worker only as path-free bytes/status. The native process never imports the PPTX parser, exposes a path or reusable handle, persists archive bytes, or broadens the existing PDF/DOCX/XLSX/document selection policy. | [`contextPicker.mjs`](contextPicker.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../contract/pptxImport.mjs`](../contract/pptxImport.mjs) · [`../src/lib/uiHostFs.ts`](../src/lib/uiHostFs.ts) | [`contextPicker.test.ts`](contextPicker.test.ts) · [`../src/lib/ui-host-fs.test.ts`](../src/lib/ui-host-fs.test.ts) · packaged PPTX smoke | requires DESKTOP-S3; requires CONTRACT-D82; refines ROOT-D1 |
| DESKTOP-V1 | verification | The packaged artifact contains only runtime roots and the backend's external-module closure, verifies the Electron archive against the official package checksum, refuses an absent output or a macOS icon that is missing/stale/default, and must pass a real executable smoke with isolated user data, SQLite, and the built renderer. The embedded `.icns` must byte-match the canonical icon generated immediately before packaging; an optional newer `.icon`-format probe is neither mistaken for this invariant nor silenced with other warnings. | [`package.mjs`](package.mjs) · [`packager.config.mjs`](packager.config.mjs) · [`icons.mjs`](icons.mjs) · [`smoke.mjs`](smoke.mjs) · [`../package.json`](../package.json) | [`icons.test.ts`](icons.test.ts) · [`runtime.test.ts`](runtime.test.ts) | refines ROOT-V1 |
| DESKTOP-V2 | verification | A direct macOS release is a separate fail-closed lane: Developer ID signing uses hardened runtime and least-privilege generic-code entitlements, notarization reads only a Keychain profile, and both the staged app and freshly extracted versioned ZIP must exactly match the planned bundle ID, display/executable names, versions, and single Mach-O architecture before signature, staple, Gatekeeper, native executable-smoke, SHA-256, and immutable-candidate checks pass. One release requires exactly two candidates—Apple Silicon `arm64` and Intel `x64`, never universal—with matching versions and strict schema-v2 receipts. The pair finalizer recomputes archive sizes and digests, validates adjacent checksums and exact receipts, publishes neither candidate when one is absent or invalid, copies every verifier and ZIP exclusively, and writes a deterministic release-set manifest last as the only completion marker; the whole new public set rolls back on partial failure. | [`release-plan.mjs`](release-plan.mjs) · [`release-publish.mjs`](release-publish.mjs) · [`release.mjs`](release.mjs) · [`release-set.mjs`](release-set.mjs) · [`entitlements.mac.plist`](entitlements.mac.plist) · [`package.mjs`](package.mjs) · [`../package.json`](../package.json) | [`release.test.ts`](release.test.ts) · [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-V1; refines ROOT-V1 |
| DESKTOP-V3 | verification | Packaged local-text acceptance keeps the native reader, trusted IPC, renderer, persistence, and endpoint transport real, fixtures only native dialog results and model responses, and proves distinct same-name snapshots survive relaunch without source files and detach independently. Its separate profile and excluded helpers cannot replace OS-backed storage proof or become shipped authority. | [`contextPicker.mjs`](contextPicker.mjs) · [`smoke.mjs`](smoke.mjs) · [`attachmentSmoke.mjs`](attachmentSmoke.mjs) · [`packager.config.mjs`](packager.config.mjs) | [`attachmentSmokeFixture.test.ts`](attachmentSmokeFixture.test.ts) · [`runtime.test.ts`](runtime.test.ts) · packaged attachment smoke | requires DESKTOP-S3; requires DESKTOP-V1 |
| DESKTOP-O1 | operations | One app instance owns one loopback backend; readiness precedes reveal, durable data lives in the OS user-data directory, and app quit gives the backend a bounded graceful shutdown. | [`main.mjs`](main.mjs) · [`runtime.mjs`](runtime.mjs) | [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-A1; refines ROOT-D1 |
| DESKTOP-O2 | operations | A trusted desktop page can create a timestamped canonical backup, reveal only the shell-owned backup directory, and initiate native restore; the sandbox receives bounded metadata or a path-free outcome, never a path, file contents, raw restore primitive, app data, or OS-vault secrets. | [`dataProtocol.mjs`](dataProtocol.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../src/components/DesktopDataCard.tsx`](../src/components/DesktopDataCard.tsx) | [`dataProtocol.test.ts`](dataProtocol.test.ts) · [`runtime.test.ts`](runtime.test.ts) · [`../src/api/desktop-data.test.ts`](../src/api/desktop-data.test.ts) · [`../e2e/desktop-data-backup.spec.ts`](../e2e/desktop-data-backup.spec.ts) · packaged smoke | requires DESKTOP-S1; requires PERSIST-D6 |
| DESKTOP-O3 | operations | Every successful desktop start best-effort ensures the current UTC day's bounded recovery point before reveal and retains a path-free ready/failed result; Customize reports that observed result instead of promising protection, and a failure keeps manual backup actionable. Startup failure leaves live data untouched and offers native restore, Show backups, or Quit; Show is the default, Quit is cancel, and startup restore explicitly discloses that no fresh safety copy can be made. | [`main.mjs`](main.mjs) · [`startupRecovery.mjs`](startupRecovery.mjs) · [`dataProtocol.mjs`](dataProtocol.mjs) · [`preload.cjs`](preload.cjs) · [`../src/components/DesktopDataCard.tsx`](../src/components/DesktopDataCard.tsx) | [`startupRecovery.test.ts`](startupRecovery.test.ts) · [`dataProtocol.test.ts`](dataProtocol.test.ts) · [`runtime.test.ts`](runtime.test.ts) · [`../e2e/desktop-data-backup.spec.ts`](../e2e/desktop-data-backup.spec.ts) · packaged smoke | requires DESKTOP-O1; requires PERSIST-D7; requires DESKTOP-O4 |
| DESKTOP-O4 | operations | Native restore accepts only one regular, non-symlink, exact-name direct child of the managed backup directory and defaults its replacement warning to Cancel. A healthy app creates a fresh safety backup first; the shell proves the backend stopped before replacement, gives a one-shot worker only persistence coordinates, requires validated read-back acknowledgement, and restarts after success or any failure once shutdown begins. Provider keys remain outside the restored state. | [`restoreProtocol.mjs`](restoreProtocol.mjs) · [`restoreLifecycle.mjs`](restoreLifecycle.mjs) · [`restoreWorker.mjs`](restoreWorker.mjs) · [`main.mjs`](main.mjs) · [`runtime.mjs`](runtime.mjs) | [`restoreProtocol.test.ts`](restoreProtocol.test.ts) · [`restoreLifecycle.test.ts`](restoreLifecycle.test.ts) · [`restoreWorker.test.ts`](restoreWorker.test.ts) · [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-O1; requires PERSIST-D8 |
| DESKTOP-O5 | operations | After its initial load succeeds, an unexpected renderer exit never leaves a dead window or restarts a healthy backend silently: one native, default-Reopen ceremony distinguishes saved device state from possibly lost unsaved window text, reopens only the last trusted route, and offers orderly Quit as cancel. Initial-load failure remains exclusively in startup recovery; reopen failure is reported generically and still drains the app. | [`nativeRecovery.mjs`](nativeRecovery.mjs) · [`rendererRecovery.mjs`](rendererRecovery.mjs) · [`main.mjs`](main.mjs) | [`nativeRecovery.test.ts`](nativeRecovery.test.ts) · [`rendererRecovery.test.ts`](rendererRecovery.test.ts) · [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-O1; requires DESKTOP-S1 |
| DESKTOP-O6 | operations | Local-service loss has one owner: an exit before the first window completes aborts startup into startup recovery, while a later unexpected exit closes stale native clients and offers one default-Restart whole-app boundary or Quit. Saved device state and possibly lost unsaved window text are distinguished, concurrent ceremonies are suppressed, and restart failure is reported generically before quit. | [`nativeRecovery.mjs`](nativeRecovery.mjs) · [`backendRecovery.mjs`](backendRecovery.mjs) · [`main.mjs`](main.mjs) | [`nativeRecovery.test.ts`](nativeRecovery.test.ts) · [`backendRecovery.test.ts`](backendRecovery.test.ts) · [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-O1; requires DESKTOP-S1 |
<!-- context-rules:end -->

## Verification

The packaged attachment phase also imports text, PDF and DOCX into saved
Documents and PPTX into saved Slides through the built New artifact form. Only the native dialog result
is a fixture; reader/IPC, extraction, review, explicit adoption and keyed
creation stay real. It verifies exact canonical bodies and reuses its existing
full app relaunch after deleting the source files. This is not actual OS-dialog
interaction, rich Office conversion, or a replacement for OS-backed keychain
acceptance in the separate ordinary executable smoke.

The ordinary executable smoke records one provider-reported turn, reads the
exact durable tenant counters and period anchors from SQLite, and compares them
after a full app relaunch. The first-run setup also saves an exact personal
model-preference record; after relaunch at a different loopback origin, a fresh
draft must show that provider and a writable composer without browser-storage
migration. This proves restart durability, not provider billing accuracy or
admission reservations for concurrent/in-flight spend.

Direct PDF selection transfers at most 8 MiB/file and 24 MiB/selection as
transient path-free bytes to the sandboxed renderer. The lazy worker extracts
text there; no PDF parser is imported into the native main process. Packaged
attachment acceptance also proves this emitted worker loads under production
CSP, and that extracted text/metadata survive relaunch without the source PDF.

Direct DOCX selection uses the same one-shot bridge, with 8 MiB/file and 24
MiB/selection limits. ZIP/XML extraction stays in a dedicated renderer worker;
only bounded body text and the strict import outcome persist. No DOCX archive
bytes, paths, external relationships, images/layout, or unsupported legacy and
macro-enabled formats cross into product state. Packaged acceptance proves the
native reader/IPC, emitted worker under production CSP, exact model body and
metadata, relaunch without the original document, and detach. The combined
PDF/Office worker budget is 1,400,000 bytes; UI graph budgets remain unchanged.

Direct PPTX selection uses the same one-shot bridge, with 8 MiB/file and 24
MiB/selection limits. ZIP/XML extraction stays in a dedicated renderer worker;
only bounded visible-slide text and the strict import outcome persist. No PPTX
archive bytes, paths, notes, layouts or media cross into product state. The
explicit Slides artifact import additionally retains source slide boundaries
in a transient review snapshot, mapping only a bounded title/bullet outline
into the ordinary authored body after adoption. Packaged acceptance proves the native reader/IPC, emitted
worker under production CSP, exact model body and metadata, relaunch without
the original presentation, and detach.

Packaged local-text acceptance also runs through `attachmentSmoke.mjs`: a
main-process native-dialog result fixture supplies real temporary paths, while
the packaged reader, trusted IPC, renderer, model transport, persistence, and
detach path remain real. It proves same-name snapshots survive a full relaunch
even after their source files disappear. No test bridge or fixture ships in
the app. This separate phase uses Playwright's Electron launcher and its own
profile; its mock-keychain switches cannot replace the ordinary executable
smoke's OS-backed storage proof. Native OS-dialog interaction and paid-provider
acceptance remain separate manual gates.

The dated [native-context acceptance record](../docs/acceptance/native-context-2026-09-10.md)
adds actual macOS selection/cancellation and source-absent relaunch evidence for
the unsigned arm64 development artifact. Its remaining native-detach cells are
explicitly unverified; it is not a complete manual or signed-release receipt.

Run `node --test "desktop/**/*.test.ts"`, then `npm run desktop:verify`. The MCP
phase proves real OS-backed token replacement/relaunch, secret exclusion,
durable disconnect despite a real vault-write failure, explicit cleanup Retry,
and unrelated provisional preservation. Its offline catalog fixture does not
prove live inspection/execution. It runs on extracted releases, outside ASAR.
The separate schema phase imports the validator from the packaged ASAR in a
real Electron utility process and proves valid/invalid values, bounded regex
termination, cancellation and worker-capacity recovery. Its helper is excluded
from the shipped archive and grants no production IPC authority.
The verified unpacked application remains an unsigned developer artifact. A public
macOS direct download must instead pass credential-gated
`npm run desktop:release:mac` once on each native architecture and then
`npm run desktop:release:mac:finalize`; no complete signed release is claimed
until Apple accepts both candidates, both freshly extracted ZIPs pass their
native release smoke, and the paired release-set manifest exists.
