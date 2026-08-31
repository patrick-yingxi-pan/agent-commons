<!-- context-schema: v1 -->
# desktop/ — Electron shell context

## Scope

Owns the near-term native application shell. Product behavior remains in the
shared UI/server contract; the shell owns only process lifecycle, trusted-window
policy, OS user-data placement, the OS-encrypted provider-credential adapter,
and packaging.

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
| DESKTOP-S2 | data-access | Provider keys are encrypted through OS-backed safe storage, never enter HTTP or product persistence, and cross the sandbox through a sender-validated write-lifecycle bridge with no read/list/raw-IPC authority. Linux `basic_text` and unknown backends fail closed; one provider retains one active device key, with create/rotation/delete and restart/non-UI reconciliation retiring superseded entries. | [`credentialVault.mjs`](credentialVault.mjs) · [`credentialProtocol.mjs`](credentialProtocol.mjs) · [`preload.cjs`](preload.cjs) · [`main.mjs`](main.mjs) · [`../src/controller/providerConnection.ts`](../src/controller/providerConnection.ts) | [`credentialVault.test.ts`](credentialVault.test.ts) · [`credentialProtocol.test.ts`](credentialProtocol.test.ts) · [`../src/controller/provider-connection.test.ts`](../src/controller/provider-connection.test.ts) · [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-S1; refines ROOT-D1 |
| DESKTOP-V1 | verification | The packaged artifact contains only runtime roots and the backend's external-module closure, verifies the Electron archive against the official package checksum, refuses an absent output, and must pass a real executable smoke with isolated user data, SQLite, and the built renderer. | [`package.mjs`](package.mjs) · [`packager.config.mjs`](packager.config.mjs) · [`smoke.mjs`](smoke.mjs) · [`../package.json`](../package.json) | [`runtime.test.ts`](runtime.test.ts) | refines ROOT-V1 |
| DESKTOP-O1 | operations | One app instance owns one loopback backend; readiness precedes reveal, durable data lives in the OS user-data directory, and app quit gives the backend a bounded graceful shutdown. | [`main.mjs`](main.mjs) · [`runtime.mjs`](runtime.mjs) | [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-A1; refines ROOT-D1 |
<!-- context-rules:end -->

## Verification

Run `node --test "desktop/**/*.test.ts"`, then `npm run desktop:verify`. A
distribution release additionally needs platform signing/notarization and an
installer-level smoke lane; the verified unpacked application is not a signed release.
