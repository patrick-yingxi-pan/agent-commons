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
- Pull requests and pushes to `main` run that exact complete verifier again in
  GitHub Actions on Node 26. Keep the workflow a projection of `npm run verify`,
  not a second hand-maintained list of checks. Its explicit two-shard and
  maximum-bounded E2E timing inputs are the measured hosted-runner profile;
  local runs continue to calibrate themselves.
- Review the working diff adversarially after tests pass. Fix confirmed findings
  before commit; do not leave finished work uncommitted.

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
