<!-- context-schema: v1 -->
# desktop/ — Electron shell context

## Scope

Owns the near-term native application shell. Product behavior remains in the
shared UI/server contract; the shell owns only process lifecycle, trusted-window
policy, OS user-data placement, and packaging.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| DESKTOP-A1 | architecture | Electron is a replaceable local host: it runs the existing desktop runtime profile and loads the unchanged HTTP/SSE UI, never importing product state into the renderer. | [`main.mjs`](main.mjs) · [`../scripts/start.mjs`](../scripts/start.mjs) | [`runtime.test.ts`](runtime.test.ts) | refines ROOT-A2; requires PORT-10 |
| DESKTOP-S1 | security | The renderer is sandboxed and unprivileged; exact loopback navigation, new windows, external schemes, permissions, and device access fail closed. | [`main.mjs`](main.mjs) · [`runtime.mjs`](runtime.mjs) | [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-A1 |
| DESKTOP-O1 | operations | One app instance owns one loopback backend; readiness precedes reveal, durable data lives in the OS user-data directory, and app quit gives the backend a bounded graceful shutdown. | [`main.mjs`](main.mjs) · [`runtime.mjs`](runtime.mjs) | [`runtime.test.ts`](runtime.test.ts) | requires DESKTOP-A1; refines ROOT-D1 |
| DESKTOP-V1 | verification | The packaged artifact contains only runtime roots and the backend's external-module closure, verifies the Electron archive against the official package checksum, refuses an absent output, and must pass a real executable smoke with isolated user data, SQLite, and the built renderer. | [`package.mjs`](package.mjs) · [`packager.config.mjs`](packager.config.mjs) · [`smoke.mjs`](smoke.mjs) · [`../package.json`](../package.json) | [`runtime.test.ts`](runtime.test.ts) · `npm run desktop:verify` | refines ROOT-V1 |
<!-- context-rules:end -->

## Verification

Run `node --test desktop/runtime.test.ts`, then `npm run desktop:verify`. A
distribution release additionally needs platform signing/notarization and an
installer-level smoke lane; the verified unpacked application is not a signed release.
