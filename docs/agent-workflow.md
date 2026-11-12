# Agent workflow — read when changing or landing code

[`AGENTS.md`](../AGENTS.md) is the boot map. This companion holds delivery
procedure so the always-loaded map stays small.

## Implement and verify

- Every feature ships with automated tests that fail on regression, and its
  requirement row in [`docs/spec/`](spec/README.md) names the implementation,
  lock, and shipped/mock status. Detailed testing discipline lives in
  [`tests/CLAUDE.md`](../tests/CLAUDE.md).
- Run `npm run typecheck` and `node --test` before declaring a code change done.
  Use `npm run verify` for the complete static/build/E2E sweep.
- Prefer `npm test` for the complete Node suite: it bounds concurrency to four
  workers. The full verifier derives the same setting from that script without
  reducing the suite manifest. This avoids observed native-helper timeouts under
  16-worker contention without raising production deadlines or adding retries.
- On Windows the verifier runs the same exact Node suite manifest in bounded,
  sequential batches to stay below process command-line limits. Every batch
  retains the npm-owned worker count; no suite is omitted or rediscovered.
  Some native filesystem fixtures still assume POSIX permissions, symlinks, and
  path separators. Use a Linux or macOS checkout for complete suite acceptance;
  the Windows launcher checks do not establish native Windows support.
- Each browser lane owns a separate absolute Playwright transform-cache path
  under ignored `.data/`, so concurrent collectors cannot rewrite each other's
  compiled modules. Suite selection, timeouts and retries are unchanged.
- Run `npm run ui:sweep` separately from the full verifier: its isolated
  5193/5194 stack overlaps the verifier's second browser shard. Never enable
  server reuse to mask this collision; wait for the first command to finish.
- Interrupt a verifier with SIGINT/SIGTERM and wait for its shutdown result
  before starting another run. Cancellation is a failed verification, even if
  a child exits cleanly; it never publishes success weights. On POSIX, the
  verifier and dev launcher signal only process groups they spawned and confirm
  closure with bounded escalation. Playwright gets SIGINT for its cleanup path
  and gives its web-server launcher a TERM grace period. SIGKILL of a supervisor
  cannot run cleanup; if ports remain occupied, identify exact test-owned PIDs
  before recovery, never kill unrelated servers or enable server reuse.
- Keep the whole tree unchanged during browser acceptance, including tests,
  scripts and documentation. Vite can reload after watched-file changes outside
  the product modules; a code-only freeze is insufficient. Apply review findings
  between runs, then verify the final revision without edits or relaxed retries.
- The complete local `npm run verify` is the mandatory pre-push gate. Do not
  rely on GitHub Actions, wait for a remote check, or dispatch/monitor workflows
  as part of routine delivery. Record the local command and outcome in the
  checkpoint handoff, including any separate UI or packaged-native acceptance.
  GitHub diagnostics are manual-only and require an explicit owner request.
  If requested, their checks lane and two deterministic E2E manifest partitions
  project the same complete verifier plan on isolated Node 26 hosts. Local runs
  retain their own shard selection and calibrated timing; optional hosted runs
  retain the measured bounded runner profile.
- Review the working diff adversarially after tests pass. Fix confirmed findings
  before commit; do not leave finished work uncommitted.
- Diagnose intermittent first-attempt browser failures with
  `E2E_TRACE=1 npm run verify`. This runs the same complete plan and retains failed
  browser traces in shard-owned directories under `test-results/` without adding
  local retries or extending timeouts; ordinary runs keep their lower-overhead
  trace policy.
  Local runs do not retry tests; optional remote runs explicitly fail retry-only
  passes and retain failed browser traces for three days. A coverage mismatch
  prints lane tails even when Playwright exited successfully; do not treat a
  retry as a repaired defect.

## Review UI changes

Use [`docs/ui-invariants.md`](ui-invariants.md),
[`docs/review-rulebook.md`](review-rulebook.md), and
[`.claude/skills/ui-review/SKILL.md`](../.claude/skills/ui-review/SKILL.md).
Review the affected surfaces in the running app at
`http://127.0.0.1:5173`, signed in with the demo-account roster stacked. The
viewer-relative cells—owner/visitor, tenant walls, capability tiers, and
per-account preferences—are requirements, not optional variants.

Leave the preview signed in as Ada when finished so the owner can continue from
the reviewed state. Credentials and roster are in
[`docs/demo-accounts.md`](demo-accounts.md).

## Keep access surfaces symmetric

The UI, permitted in-session MCP, and authenticated remote MCP are semantic
projections of the route-owned capability table (INV-11). A UI change that adds
no backend operation needs no invented endpoint. If MCP initialization prose
quotes UI copy, update `MCP_UI_COPY` in [`server/mcp.ts`](../server/mcp.ts); its
live-copy lock is [`server/mcp-ui-sync.test.ts`](../server/mcp-ui-sync.test.ts).
Full boundary rules: [`docs/mcp-access.md`](mcp-access.md).

## Land the change

Commit and push directly to `main` over HTTPS after verification and diff
review. Preserve unrelated work in a dirty tree; never erase or rewrite it to
make a patch easier.
