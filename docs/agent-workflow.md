# Agent workflow — read when changing or landing code

[`AGENTS.md`](../AGENTS.md) is the boot map. This companion holds delivery
procedure so the always-loaded map stays small.

## Implement and verify

- Every feature ships with automated tests that fail on regression, and its
  requirement row in [`docs/spec/`](spec/README.md) names the implementation,
  lock, and shipped/mock status. Detailed testing discipline lives in
  [`tests/CLAUDE.md`](../tests/CLAUDE.md).
- During development, use `npm run typecheck` and the tests that exercise the
  change for local feedback. Running the complete `npm run verify` locally
  before pushing is optional.
- Prefer `npm test` for the complete Node suite: it bounds concurrency to four
  workers. The full verifier derives the same setting from that script without
  reducing the suite manifest. This avoids observed native-helper timeouts under
  16-worker contention without raising production deadlines or adding retries.
- On Windows the verifier runs the same exact Node suite manifest in bounded,
  sequential batches to stay below process command-line limits. Every batch
  retains the npm-owned worker count; no suite is omitted or rediscovered.
  Some native filesystem fixtures still assume POSIX permissions, symlinks, and
  path separators. Use Linux or macOS when running the complete suite locally.
  The Windows launcher checks do not establish native Windows support.
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
- GitHub enforces the complete verifier on every pull request to `main`.
  `Checks` runs typecheck, the full Node suite and the production build. All six
  browser jobs (`E2E 1/6` through `E2E 6/6`) must also pass. GitHub reruns the
  verifier on pushes to `main` and supports manual dispatch for diagnostics.
  The rules for `main` also require `Dependency review` and CodeQL code scanning.
  Dependency review rejects newly introduced high or critical vulnerabilities.
  The pull request contains the GitHub results. Record any local checks
  performed and applicable signed-in UI or packaged-native acceptance in the
  pull request and checkpoint handoff.
  The checks lane and six deterministic E2E manifest partitions run on
  isolated Node 26 hosts. Local runs retain their own shard selection and
  calibrated timing; hosted runs retain the measured bounded runner profile.
- Review the working diff and fix confirmed findings before committing. After
  GitHub checks pass, review the diff on the tested revision before merging.
- Diagnose intermittent first-attempt browser failures with
  `E2E_TRACE=1 npm run verify`. This runs the same complete plan and retains failed
  browser traces in shard-owned directories under `test-results/` without adding
  local retries or extending timeouts; ordinary runs keep their lower-overhead
  trace policy.
  Local runs do not retry tests; remote runs explicitly fail retry-only
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

After diff review, commit and push a branch over HTTPS, then open a pull
request targeting `main`. Preserve unrelated work in a dirty tree; never
erase or rewrite it to make a patch easier.

Wait for the required GitHub checks on the current revision, fix failures, and
resolve review conversations before merging. Keep the branch up to date when
GitHub requires it. After a fix or base update, wait for GitHub to verify the
new revision. Do not bypass the pull-request or required-check rules. A
separate approving reviewer is not required for the solo-maintainer workflow;
maintainer diff review remains mandatory.

### Commit attribution

For model-assisted changes, use the human contributor's GitHub-linked identity
as the Git author. If the clone uses a different identity, set `user.name` and
`user.email` for the individual `git commit` with `git -c`.

Credit the contributing model by its session model ID and reasoning effort. Read
both from the session or confirm them with the contributor. Separate the trailer
block from the commit body with a blank line. Use this format.

```text
Co-authored-by: gpt-6.2-astra (ultra) <gpt-6.2-astra-ultra@models.agent-commons.invalid>
```

The reserved `.invalid` address identifies the model and effort for display.
GitHub can then show the trailer's name without substituting a linked account's
username. Preserve all contributor trailers in the final squash commit message
(`gh pr merge --squash --body-file` accepts a message body). Verify the authors
GitHub displays on the merged commit.
