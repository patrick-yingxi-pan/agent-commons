# Native Contribution MCP fixture acceptance — 2026-10-08

Passed on macOS 26.5.2 (25F84), Apple Silicon, using the ordinary unsigned
Electron 44 executable and OS-backed authentication/credential storage.
The source package was built from `c268c3ce` plus this checkpoint's test and
documentation changes. No product runtime behavior changed.

## Scope and identity

The original package refused the local MCP connection before any peer request.
The acceptance helper then copied the app into a private generated directory
and changed only the copied ASAR's `scripts/start.mjs` loopback admission switch.
No environment flag or production bypass was added. Helpers are package-excluded;
the signed-release smoke never substitutes the modified app. Generated accounts,
profile, credential and peer were isolated from the owner's development data.

- Original ASAR SHA-256: `3adf5d10774de075b54c6c52b07548eb2cc889e75936614ab0a129fd128f5437`.
- Fixture ASAR SHA-256: `33f4d82a919a972a89612a17223124eb45fbfd008d89aa415e78b44040287828`.
- The original digest was rechecked after creation and cleanup; it did not change.

This is local HTTP fixture acceptance, not production TLS/public-service,
paid-provider, signed/notarized or Intel acceptance. Provisioning used the actual
trusted native bridge; no manual credential-entry or OS-dialog claim is made.

## Verified workflow

Rendered proposal and envelope approval, followed by opening the separate Run
confirmation, made zero calls. Confirming once sent the exact reviewed Unicode
arguments with the device-vault bearer. Public history and SQLite retained the
exact normalized text/structured result. The raw bearer was absent from the
encrypted vault bytes, SQLite files and portable backup.

A genuinely shared Project reader saw the same inert receipt and no Run control
or private connection authority. A foreign account could read neither the
Contribution nor its arguments. A second confirmed call was held by the real
HTTP peer; the pending receipt and second slot were observed in SQLite before
the entire app exited. Independent signed-in relaunch durably converted that
same attempt to uncertainty without replay or changing the encrypted auth root.
Same-key Retry returned history only. A third separately confirmed call retained
its own distinct result and exhausted the three-slot envelope. The final history
was `done`, `uncertain`, `done`; managed backup retained it exactly.

## Evidence and regression sensitivity

`npm run desktop:verify` passed the rebuilt ordinary native suite and this new
gate. After exact-result assertions were strengthened, a separate
`npm run desktop:smoke:mcp-effects` passed against the identical source ASAR.
All five final captures were inspected: consent, owner success, reader history,
recovered uncertainty and the final completed call after capacity exhaustion.
Local generated evidence is under
`.data/desktop-contribution-mcp-smoke/run-rF6u3q/`; it is not shipped or committed.

Disabling pending-to-uncertain recovery in a disposable build made the native
journey fail at its exact uncertain-receipt check after relaunch. Removing the
smoke's package exclusion failed its shipping lock. Disabling fixture bearer
validation failed with HTTP 200 instead of 401; disabling the copy helper's
final source hash check failed its expected source-mutation rejection. All
mutations were restored before positive acceptance. Focused helper, runtime,
context and spec locks passed. The complete local verifier remains mandatory
before landing; GitHub CI is not used.

Implementation and constraints: [DESKTOP-V14](../../desktop/CLAUDE.md),
[native journey](../../desktop/contributionMcpSmoke.mjs),
[private copy helper](../../desktop/mcpLoopbackSmokePackage.mjs), and
[local peer](../../desktop/contributionMcpSmokeFixture.mjs).
