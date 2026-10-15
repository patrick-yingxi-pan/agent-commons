# Native Agent Requests acceptance — 2026-10-15

## Scope and result

The original unsigned Apple Silicon app passed actual macOS **Cancel**, then
**Allow local server** in a fresh setup review, followed by the complete private
Agent Requests workflow. Native controls were operated through accessibility;
no native dialog result or packaged code was replaced. The authored MCP peer
and bounded loopback model made no paid-provider or third-party service calls.

This closes the Agent Requests setup-dialog gap only. It does not establish
signed/notarized distribution, native Intel operation, third-party MCP
compatibility, paid-provider behavior, or arbitrary local-program safety.

## Artifact and isolation

- Package source: `3287b73e`; Electron 44.7.2, Agent Commons 0.1.0 arm64.
  Later changes through `508d0758` affect release tooling and records, not this
  product runtime. The excluded acceptance driver adds `--native-review`.
- Host: macOS 26.5.2 (25F84); driver Node 26.3.0.
- Original app.asar SHA-256 before and after the run:
  `94c075751af00ff6ae7791f2fe8b80400d13548b3f8f4af21654eedfdf61f410`.
- Command: `npm run desktop:smoke:agent-requests -- --native-review`.
  The first attempt exited zero with the existing 30-second assertion bounds.
- Native review displayed Node running the repository's
  [authored peer](../../desktop/mcpStdioSmokePeer.mjs), the repository working
  directory, and one generated trace-file argument with its matching explicit
  environment entry. It disclosed normal macOS access, inspection effects, and
  separate conversation, Contribution, Agent Request, Routine and Commission
  approval requirements.
- Connection: `mcp-connection-c39768715783e2462501b2f96e27f12e`.
  Both real authenticated test people and all private SQLite state existed only
  in the generated profile. OS-backed authentication and launch custody were
  not substituted. The app was selected only while its test-owned PID was live.
- Six renderer captures and a machine-readable receipt remain in the ignored
  `.data/desktop-agent-requests-smoke/run-iAt2JA` directory. Both app launches and
  the model fixture closed; the generated profile was removed. No normal owner
  profile was opened or used.

## Observed boundaries

| Boundary | Observed result |
| --- | --- |
| Cancel | The cancellation message appeared, the exact connection was unchanged, and neither child trace nor encrypted launch grant existed. |
| Fresh Allow | Reopening configuration required another native review. Inspection started one authored child and exposed exactly `records.search`, without a tool call. |
| Draft and Run | One explicit model draft left editable arguments unchanged until Use. Review still required a separate initially unchecked local-program acknowledgement before Run once. The call matched the reviewed arguments exactly. |
| Private result | Only the receiving person could read the exact call/result and argument draft. The requesting person saw neither private receipt nor raw result. |
| Share | Separately reviewed text alone reached the requester; private execution history remained intact in SQLite. |
| Full relaunch | The owner remained signed in with the exact authentication root. A pending tool call and separate pending model draft recovered as uncertain without retries; the completed/shared request remained exact. |
| Cardinality | The entire walk made two authored tool calls and two loopback model requests. Relaunch and history reads added none. |

The [driver](../../desktop/agentRequestSmoke.mjs) retains the default disposable
fixture-dialog mode for unattended verification. Native mode clears all fixture
approval variables, uses the original executable for both launches, checks the
original ASAR before recording success and again during cleanup, and labels
its evidence separately. [Colocated locks](../../desktop/agentRequestSmoke.test.ts)
detect loss of those boundaries; deliberate mutations remove fixture gating,
the pre-evidence hash check, cancellation custody checks or bounded review.

All six captures were reviewed. Setup images show renderer results after native
consent, not native-dialog screenshots; live accessibility observations supply
the native-dialog evidence. The pending/recovered images preserve the current
scroll position and are functional evidence, not a complete layout matrix.
Broader account-wall, revocation, malformed-input and storage-failure matrices
remain automated evidence. No product security policy or deadline was relaxed.
