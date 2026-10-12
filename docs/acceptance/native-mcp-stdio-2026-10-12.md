# Native local-MCP consent acceptance — 2026-10-12

## Scope and result

The unchanged packaged app passed the complete local stdio acceptance walk with
actual macOS **Cancel**, then **Allow local server** in a fresh review. Native
controls were operated through the accessibility UI; no dialog-result override
or fixture approval was installed. This is unsigned Apple Silicon evidence for
a reviewed repository-authored test program, not third-party-server,
signed/notarized, Intel, public-service or update-installation acceptance.

## Artifact and isolation

- Source revision: `2d2d7a543e4608207119d984b193d80250365db9`.
- Original arm64 package, Agent Commons 0.1.0. Its app.asar SHA-256 was
  `63c230860e566629ec781bb87e148ce3cbb996870c09cd7ebc301bbcd7be09ed`;
  the harness checked that the original archive stayed unchanged.
- Host: macOS 26.5.2, build 25F84; Electron 44.0.0.
- Command: `npm run desktop:smoke:stdio -- --native-review`, using Node 26.3.0.
  The successful run exited zero with all subsequent assertions enabled.
- The ordinary packaged executable used a generated private profile and a
  smoke-only loopback debugging endpoint. Playwright drove the rendered product
  workflow; actual native controls supplied the two launch-consent answers.
  OS-backed storage remained real; no mock-Keychain switch was added.
- The reviewed command was Node running the repository's
  [local peer](../../desktop/mcpStdioSmokePeer.mjs), with one explicit temporary
  trace-file argument and matching environment entry. The peer uses no shell or
  network. Model responses came only from the bounded credential-free loopback
  fixture. No real service credentials or external service calls were used.
- Successful connection: `mcp-connection-27bd63b15dc66f35a952c60d51548d2b`;
  display name: `Local stdio fixture 732144f9`.
- Seven renderer captures remain under the local ignored evidence directory
  `.data/desktop-stdio-smoke/run-sIno6y`. The harness closed both app launches,
  stopped the model fixture and removed its disposable profile after completion.

## Observed workflow

| Boundary | Evidence |
| --- | --- |
| Native review | The real dialog disclosed ordinary macOS access, inspection effects, exact executable/arguments/directory/environment, person/connection identity, separate conversation and Contribution approval, and unavailable Routine execution. |
| Cancel | The rendered cancellation message appeared. Exact public and private connection records were unchanged; neither the child trace nor encrypted launch custody existed. |
| Fresh Allow | A new Configure action opened a fresh native review of the same exact launch. Allow produced one process with discovery and catalog requests only; the catalog contained exactly `records.search`. |
| Separate tool consent | A proposed call alone executed nothing. Rendered Run tool caused exactly one call with the expected arguments and inert result. SQLite retained the exact person/tenant/connection authority. |
| Contribution | Separate Project approval and Run resolved the reviewed item through ordinary landing. A second named call stayed pending until app shutdown. |
| Relaunch | The same person remained signed in. Exact connection/grant and completed-call authority survived; completed results and interrupted Contribution history rendered without another child or model request. Receipt recovery did not redispatch. |
| Disconnect/removal | Disconnect changed the encrypted custody file before removal was enabled. Removal retained the retired grant state and history and started no program. |
| Private launch data | The executable path was absent from portable SQLite files and the protocol trace, and was not plaintext in the encrypted grant. |

Assertions are owned by [the stdio harness](../../desktop/mcpStdioSmoke.mjs) and
[its Contribution walk](../../desktop/contributionStdioSmoke.mjs). The captures
support rendered-state review; native dialog wording and actions were observed
through the live accessibility tree, not inferred from those renderer images.

## Control failures and limitations

Three preceding attempts did not pass. The first encountered a macOS
screen-capture error before answering Cancel; the next two proved cancellation
but UI-control stale-state refusals prevented Allow before the unchanged
30-second assertion deadline. These runs are not counted as completed acceptance.
The final attempt refreshed and operated each visible native control within the
same UI call; no product deadline, test timeout, retry setting or consent policy
was changed.

During recovery from the first two attempts, selecting the app after test exit
opened its normal empty window. It was closed through the native Quit menu
without content edits and was not used as a test profile. No normal-profile
cleanup was attempted. The repository preview store retained its prior size
and modification time (11,095 bytes; Unix mtime 1791709977); no preview mutation
was part of this acceptance.

The authored peer's behavior does not prove safety of arbitrary local software:
local MCP is not a sandbox. Broader protocol, malformed-input, account-wall,
storage-failure and revocation matrices remain automated evidence. Routine
stdio and unattended Commission effects remain unavailable. Signing/notarization,
native Intel execution, real update installation and external-service acceptance
still require their own evidence and authorized inputs.

All seven renderer captures were reviewed. The relaunched-result image contains
the expected completed receipt but shows the transcript dimmed; it is not claimed
as settled visual-quality evidence. Exact durable-state and no-redispatch
assertions, rather than that appearance, establish the restart result.
