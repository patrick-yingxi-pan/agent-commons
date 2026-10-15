# Intel Rosetta startup diagnostic — 2026-10-15

## Result and scope

**Startup failed; this is not release acceptance.** The ordinary x64 packaged
smoke passed its bundled Git, image OCR and sandboxed PDF OCR phases, then
failed the existing 25-second readiness deadline in the missing-profile-leaf
case. The app emitted no readiness or error output. No subsequent ordinary
authentication, credential, onboarding or relaunch workflow passed in this run.

A separate observation allowed the unchanged executable 60 seconds to start.
It also never became ready. This was diagnostic observation, not an increased
acceptance deadline or a successful retry. At about ten seconds, a one-second
process sample showed the main thread in `SecItemCopyMatching`,
`SecKeychainItemCopyContent` and `Security::SecurityServer::ClientSession::decrypt`,
waiting in `mach_msg`. The sample establishes a Keychain wait, not which prompt,
permission, code identity or OS condition caused it.

## Artifact and execution environment

- Application source: `3287b73ed22d6ce495267c0b5d85a2ca1e527bcd`; the subsequent
  `a5197611` checkpoint changed only the production plan.
- Agent Commons 0.1.0; Electron 44.7.2; x64 package on an Apple Silicon host
  running macOS 26.5.2 (25F84). The process sample reports
  `X86-64 (translated)`, not native Intel execution.
- Both the x64 and previously accepted arm64 packages retain app.asar SHA-256
  `94c075751af00ff6ae7791f2fe8b80400d13548b3f8f4af21654eedfdf61f410`.
  Both were rehashed after the diagnostic; neither application payload changed.
- The harness used official Node 26.3.0 darwin-x64, extracted into a generated
  temporary directory rather than installed globally. Its archive SHA-256
  `7453bd54a17bdc656e2e784d702f6eeb224fb517965e6f8c5a31a88c83d3804c`
  matched the official Node release checksum. The harness independently reported
  `process.arch === 'x64'` and `process.version === 'v26.3.0'`.
- The x64 outer app is unsigned. The arm64 main executable has a linker-produced
  ad-hoc signature, no Team ID and no sealed resources. Neither is a Developer ID
  candidate. The separately sealed PDF helpers remain distinct from outer-app
  signing; their checks do not establish the main app's Keychain identity.

## Isolation and observations

The smoke and diagnostic launched the ordinary executable with explicit,
generated temporary user-data paths. They did not add a debugging port, mock
Keychain, altered encryption implementation or widened timeout to the acceptance
gate. The extended observation did not load an instrumented ASAR. Its profile
contained only Chromium cache/single-instance entries at each five-second check;
no authentication-root or SQLite database file appeared. Its owned process was
stopped and its generated profile removed afterward.

The successful helper phases exercised generated Git repositories and image/PDF
fixtures. The Git log's generic phrase “native architecture” means the executable
matched the x64 harness; on this host it does **not** mean native Intel hardware.
The helper phases do not substitute for full application startup.

During UI inspection, selecting the test app after the isolated process had
ended unintentionally launched an extra default-profile instance. That exact
new process was identified and stopped. No owner-profile files were deleted or
manually repaired. The observed database and authentication-root modification
times predated the incident, while the profile directory's modification time
changed. There was no before/after content hash, so this record does not claim
the entire default profile was untouched. Future inspection must not use an
app-selection operation that can relaunch a departed test process.

## Next evidence and constraints

1. Resolve the startup wait with real OS-backed storage, observing any required
   owner-mediated Keychain interaction. Do not change ACLs, grant blanket access,
   replace saved keys or inspect real credentials to make a test pass.
2. Keep the original 25-second ordinary smoke deadline and fail-closed storage
   policy. A longer diagnostic observation or helper-only pass is not acceptance.
3. Before changing storage APIs, establish existing ciphertext compatibility,
   secure-provider availability, actual nonblocking behavior and late-result
   lifetimes. Promise-returning methods alone prove none of these properties.
4. Run the signed/notarized candidate lane on both native architectures once
   enrollment, signing/notarization authorization and Intel hardware are ready.
   Rosetta evidence cannot satisfy that native Intel requirement.

No paid model, external MCP service, release publication, signing credential or
notarization credential was used. No claim is made that code signing alone fixes
the wait. Earlier arm64 startup delays had different sampled stacks and are not
attributed to this cause.

## Follow-up: isolated asynchronous-storage feasibility probes

Before changing production encryption, generated app copies replaced only their
copied startup entry point with a synthetic, non-secret storage probe. The
original packages and their saved data were not changed. These are feasibility
experiments, not executable-smoke acceptance or a shipped storage migration.

The arm64 copy passed actual OS-backed encryption/decryption in both directions:
synchronous `v10` ciphertext through asynchronous decryption, and asynchronous
`v10` ciphertext through synchronous decryption. Its async round trip returned
the exact synthetic text with `shouldReEncrypt: false`; prefixless and truncated
input were rejected. It exited zero. This demonstrates that fixture's current
macOS ciphertext compatibility, not every stored record, platform, future key
rotation or failure state.

The x64 copy retaining the ordinary module imports did not emit the first probe
marker within the 25-second parent deadline. A smaller copied entry point loaded
Electron through `createRequire` and accessed safeStorage after app readiness.
It reached asynchronous initialization and emitted a heartbeat, but still did
not finish within that parent deadline.

One further **diagnostic-only** 60-second observation of the minimal entry point
recorded its first module marker at 22,497 ms and async initialization starting
at about 22,897 ms. Nineteen one-second heartbeats ran while initialization stayed
pending. The probe's own 20-second timer fired at 42,889 ms and called
`app.exit(2)`, but the process did not exit before the 60-second parent deadline.
The parent then stopped the exact owned child. All probe processes were confirmed
absent after cleanup, and their generated app/profile copies were removed.

This establishes observable event-loop responsiveness during that async wait.
It does **not** establish usable Intel encryption, bounded native shutdown, or
that replacing application-level storage calls resolves the original startup
failure. No probe made an owner Keychain decision, relaxed an acceptance deadline,
used plaintext/mock encryption, or read an existing provider/MCP credential.

The [pinned Electron binding](https://raw.githubusercontent.com/electron/electron/v44.7.2/shell/browser/api/electron_api_safe_storage.cc)
also resolves async availability when an encryptor object arrives; that boolean
alone does not demonstrate a usable key. Any later adapter must preserve actual
operation failure, existing ciphertext and no-rotation-on-unreadable-root
semantics. The current production storage path remains unchanged.

## Machine-local diagnostic evidence

These files are local diagnostic outputs, not shipped assets or release receipts:

- `/private/tmp/ac-intel-rosetta-smoke.log` — failed ordinary smoke.
- `/private/tmp/ac-intel-startup-observation.log` — separate 60-second observation.
- `/private/tmp/ac-intel-startup-sample-13360.txt` — sampled translated process.
- `/private/tmp/ac-intel-static-preflight-result.json` — preceding static checks,
  whose `nativeIntelExecuted: false` remains accurate.
- `/private/tmp/ac-safe-storage-compatibility-arm64.log` — passing synthetic
  bidirectional compatibility in a copied arm64 app.
- `/private/tmp/ac-safe-storage-compatibility-x64.log` — 25-second full-import
  copied-entry probe failure.
- `/private/tmp/ac-safe-storage-compatibility-x64-minimal.log` — 25-second minimal
  copied-entry probe failure.
- `/private/tmp/ac-safe-storage-compatibility-x64-observation.log` — extended
  diagnostic responsiveness and failed exit observation.
