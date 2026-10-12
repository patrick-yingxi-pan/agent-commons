# Packaged Commission MCP acceptance — 2026-10-12

This record covers the explicit owner-approved HTTP Commission path, not legacy
Standing execution, Agent proxies, local stdio or general third-party safety.

## Artifact and isolation

- Product revision: `6a64b11341d9fb007ea3881741d8a2fdbcee2e4a`, with the separate
  acceptance driver and package-exclusion integration added in this checkpoint.
- Platform: native Apple Silicon, unsigned macOS Electron package.
- Original ASAR SHA-256:
  `9a462c0654f4e86f485af7bdb1a31e9d6a34f67ea139d5fdf369f7552534d268`.
- Accepted disposable copy ASAR SHA-256:
  `e9c211a84c57cf223f637cc0938e611e3f370ea470adc1a4d6e87417660d05bf`.
- Command: `npm run desktop:smoke:commission-mcp`, using Node 26.
- Local evidence: `.data/desktop-commission-mcp-smoke/run-Jj9Dts/evidence.json`.

The original package refuses a loopback connection without contacting the peer.
The existing copy builder changes only startup loopback admission in a generated
private app copy and verifies the source archive hash through cleanup. The
ordinary executable launcher uses real OS-backed storage, not a mock Keychain
switch. Accounts, workspace data, credentials, model and MCP peers are locally
authored disposable fixtures; no owner store or external account is used.
The driver and Messages fixture never ship and are not signed-candidate smoke.

## Observed workflow

1. Inspected the exact bearer-authenticated tool through native encrypted
   custody. Raw token bytes were absent from the vault, SQLite and backup.
2. Kept posted work open through legacy Standing and an unsubmitted rendered
   review, observing beyond a full five-second worker cadence.
3. Approved exact model/tool/fixed arguments in the UI. The actual worker made
   one tool-free preparation and one HTTP effect; SQLite retained owner-bound
   history and reported usage. Only known success resolved work and earned
   Agent credit. Public provenance was derived, absent from the stored work row.
4. Verified shared foreign-reader and outsider walls: public completion remains
   visible to readers, while approval, exact arguments, results and connection
   custody remain private.
5. Exited and independently relaunched the app. Sign-in, encrypted authentication
   root, exact completed claim and permission survived. Rendered revocation
   left newly posted work open through another full worker cadence.
6. Reapproved, held the peer response, and observed a durable pending effect
   before and after process exit. Startup converted that exact claim to
   uncertainty and withdrew approval, without completing work or awarding credit.
7. Renewed approval did not repeat the uncertain item or its model preparation.
   New work executed once. Final histories were `done`, `uncertain`, `done`, with
   three preparations, three calls and two completion credits. Managed backup
   retained the exact private claim and usage ledgers.

The initial failed attempt was a harness query error: usage reservations are
SQLite entity rows, not a singleton. Correcting that read-only query produced
the accepted run. A negative-control package with `CommissionMcpRegistry.recover`
disabled subsequently failed at the rendered `Outcome uncertain` assertion.
The original archive remained unchanged; no production recovery switch exists.

## Remaining gates

This is local-peer implementation evidence, not public TLS/service compatibility,
paid-provider, signed/notarized, native Intel, live update or explicit-restore
acceptance. Same-workspace person isolation is separately covered by the browser
identity fixture; this native test does not bypass the production one-namespace
account model. Local receipts provide no anti-rollback or external exactly-once
guarantee. Broader MOCK-9 and the production plan's release gates remain open.
