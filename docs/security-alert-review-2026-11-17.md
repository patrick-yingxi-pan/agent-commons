# Security alert review — 2026-11-17

This review accounts for CodeQL alerts **1–27** and Dependabot alert **20** in
`patrick-yingxi-pan/agent-commons`, starting from commit
`525f67ff16107c96b1e02a9c9ac5ef4298d5355d`. The initial CodeQL set contained
22 high and 5 medium findings. Alert severity describes the query result;
source, caller, persistence and test evidence determine the disposition below.

The changes correct the production MIME parser's excessive backtracking,
restrict browser recovery persistence to explicit permitted fields, repair
unsafe or imprecise test-harness behavior, and update the vulnerable archive
tooling dependency. Unchanged findings have individual explanations for
false-positive or intentional-test dismissal. No query, source directory or
security check is excluded to make the scan pass.

This is a triage and focused-regression record. Complete local verification,
required GitHub checks and final alert states must be recorded in the delivery
pull request before landing; they are not inferred from the focused results.

## Code corrections

| Alert | Severity and rule | Finding, correction and evidence |
|---|---|---|
| 1 | High — `js/redos` | Untrusted MCP MIME metadata reached a regular expression with overlapping repetition. [The parser](../server/mcpToolResult.ts) now enforces the existing 256-character bound, splits parameter boundaries once and checks each component without a backtracking expression across parameters. [Regression tests](../server/mcp-tool-result.test.ts) cover accepted/rejected grammar and run the adversarial input in a bounded child process. The old parser exceeded that child's five-second deadline; the corrected parser passes. |
| 14 | High — `js/cors-misconfiguration-for-credentials` | The [stop-recovery E2E peer](../e2e/stop-recovery.spec.ts) reflected arbitrary origins while allowing credentials. It now admits only the configured test-app origin, refuses foreign origins without CORS headers, and emits the known origin. Foreign and allowed preflights are asserted before the cancellation browser walk. This fixes the test server without changing product CORS policy. |
| 16 | Medium — `js/bad-code-sanitization` | The [OAuth packaged-smoke adapter](../desktop/mcpOAuthSmoke.mjs) previously interpolated a validated origin string into generated source. It now interpolates only an explicitly bounded numeric port beside a fixed loopback literal. [Tests](../desktop/mcpOAuthSmoke.test.ts) reject foreign/suffix hosts, credentials, paths, queries containing code, fragments and port zero. |
| 17 | Medium — `js/bad-code-sanitization` | The second generated adapter in the same [OAuth smoke harness](../desktop/mcpOAuthSmoke.mjs) uses the same numeric-only construction. The [regression suite](../desktop/mcpOAuthSmoke.test.ts) also accepts canonical loopback origins and their default port; removing numeric admission makes its negative test fail. These adapters remain excluded from production packaging. |
| 20 | High — `js/incomplete-hostname-regexp` | In the [release test](../desktop/release.test.ts), the dynamic regex input was a field name, not the adjacent invalid URL from the test table. The assertion now uses `RegExp.escape` so future field names are also literal. Existing release tests still reject mismatched update URLs. |
| 21 | High — `js/incomplete-hostname-regexp` | The [DOCX fixture assertion](../tests/helpers/docxFixture.test.ts) had unescaped dots in the expected namespace. Escaping them prevents a lookalike such as `schemasXopenxmlformats.org` from satisfying the test. That namespace mutation was observed to fail. |
| 22 | High — `js/clear-text-storage-of-sensitive-data` | [API-token recovery persistence](../src/controller/apiTokenMintIntentPersistence.ts) is intended to store account scope, label and idempotency coordinates, not a bearer. No current caller was observed passing a revealed bearer into this module, but structural typing and object spreads allowed unexpected runtime properties to survive. Loading, saving and returning records now explicitly project the allowed fields. [Tests](../src/controller/api-token-mint-intent-persistence.test.ts) inject bearer/response fields both through fresh input and old stored records and verify their removal. |
| 23 | High — `js/clear-text-storage-of-sensitive-data` | [Provider-secret rotation recovery](../src/controller/providerSecretRotationIntentPersistence.ts) now explicitly projects account, tenant, provider, revision and idempotency coordinates at every persistence boundary. No current secret-bearing caller was identified; this closes the same extra-property gap without removing reload recovery. [Tests](../src/controller/provider-secret-rotation-intent-persistence.test.ts) prove fresh or previously stored secret/API-key fields neither return to callers nor survive rewriting. |
| 24 | Medium — `js/stack-trace-exposure` | The [OpenAI phase HTTP fixture](../server/model/openai-phase.test.ts) now returns a constant wire error while retaining the original exception locally. An `afterEach` assertion makes unexpected fixture failures fail the test with local diagnostics. Its synthetic exception canary never appears in the HTTP response; restoring the reflected error makes the regression fail. |
| 25 | Medium — `js/stack-trace-exposure` | The [OpenAI provider HTTP fixture](../server/model/openai-provider.test.ts) uses the same constant wire error and local exception collection. The canary regression fails if the response again includes the original exception message. |
| 26 | Medium — `js/stack-trace-exposure` | The [assistant-text persistence peer](../server/persistence/assistant-text-items.test.ts) now returns constant error JSON instead of an assertion message. An intentionally invalid HTTP method proves the assertion remains local; both real JSON and SQLite restart paths retain their behavioral checks. |
| 27 | High — `js/incomplete-sanitization` | In the [relay-primer test](../tests/relay-primer.test.ts), `replace('../', '')` only formatted an assertion label; file reading already used the unchanged relative URL. An explicit leading-prefix check and `slice(3)` now express that one-prefix display operation. No filesystem path authorization changes. |

The four new persistence adversarial cases failed against the old implementation
and passed after explicit projection. The MIME and persistence suites together
passed **20 tests** under Node 26. Existing names, scan coverage, recovery
semantics, timeout policies and retries remain intact.

## Findings retained with individual dismissal evidence

Alerts 2–12, 15, 18 and 19 were individually dismissed on GitHub as false
positives with finding-specific explanations; alert 13 was dismissed as used
in tests. Their implementations remain covered by the existing suites.

The [insufficient-password-hash query](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
concerns password-storage verification. SHA-256 checksums, keyed message
authentication and in-memory cache identity have different purposes. Replacing
these operations with password derivation would not fix the reported issue and
would change durable identities or protocol behavior.

| Alert | Disposition | Source/caller finding and locking evidence |
|---|---|---|
| 2 | False positive | [Session signing](../server/auth.ts) computes HMAC-SHA256 over explicit public claims, keyed by the server signing secret. [Routes](../server/routes/index.ts) construct claim objects after account/token verification; password records are not serialized into the MAC. Actual [account passwords](../server/accounts.ts) use scrypt with per-user random salts and timing-safe comparison. [Session tests](../server/auth-session.test.ts) and [account tests](../server/auth-accounts.test.ts) cover these distinct boundaries. |
| 3 | False positive | [Commission claim hashes](../server/commissionMcpClaim.ts) bind frozen permission, work, tool and start time. They are join-integrity checks, not authentication or permission grants; live authority is checked separately. [Claim tests](../server/commission-mcp-claim.test.ts) reject changed components. |
| 4 | False positive | [Commission execution-state hashes](../server/commissionMcpState.ts) identify the exact frozen approved invocation and receipt. OAuth-named fixture fields represent owner/connection identity, not password material. [State tests](../server/commission-mcp-state.test.ts) reject mismatched call/time/grant identity. |
| 5 | False positive | [Contribution-effect hashes](../server/contributionEffectState.ts) fingerprint canonical entity, owner, transport and approved-call identity to prevent receipt retargeting. Connection-creation IDs are opaque resource identifiers. [State tests](../server/contribution-effect-state.test.ts) cover that binding; this hash does not verify a credential. |
| 6 | False positive | [Contribution-review hashes](../server/contributionReviewState.ts) identify a ChangesetVersion so a saved review counts only for the exact current content. Public projection removes the private hash. [Review-state tests](../server/contribution-review-state.test.ts) prove stale-content rejection. |
| 7 | False positive | [Image asset IDs](../server/imageAssets.ts) are tenant-scoped content addresses over validated image data and metadata. Deterministic content identity is separate from credential verification and is subject to image/registry bounds. [Asset tests](../server/imageAssets.test.ts) cover deduplication and tenant separation. |
| 8 | False positive | [MCP tool-schema hashes](../server/mcpToolAdmission.ts) select name, input schema and optional output schema; changing them invalidates reviewed consent. OAuth-like catalog data does not make schema identity a password verifier. [Admission tests](../server/mcp-tool-admission.test.ts) cover exact schema identity and separate validation. |
| 9 | False positive | [Provider-usage cache identity](../server/providerUsage.ts) includes the provider API key so rotation cannot reuse an earlier balance/usage observation. The digest exists only in a bounded private in-memory map; snapshots expose usage data without keys or digests. [Usage tests](../server/provider-usage.test.ts) cover rotation and provider isolation. It is not stored-password verification. |
| 10 | False positive | [Agent-request state hashes](../server/proxyRequestState.ts) bind the exact approved call and start time to an execution receipt. The module does not grant access; host checks remain separate. [Request-state tests](../server/proxy-request-state.test.ts) reject stale or retargeted receipts. |
| 11 | False positive | [Routine-state hashes](../server/routineMcpState.ts) bind frozen permission, run, receipt and call identity. [OAuth authority](../server/routineMcpPolicy.ts) contains owner/connection IDs, not bearer tokens. [State tests](../server/routine-mcp-state.test.ts) cover approval/call consistency. |
| 12 | False positive | [Routine decision hashes](../server/routineMcpRegistry.ts) derive scoped IDs and enforce exact idempotent replay of approve/revoke request shapes. The reported `approveRequest` flow constructs decision fixtures, not passwords. [Registry tests](../server/routine-mcp-registry.test.ts) cover mismatched replay rejection. |
| 13 | Used in tests | The [PDF fixture](../tests/helpers/pdfFixture.mjs) intentionally implements legacy Standard R2 MD5/RC4 protection to test encrypted-file detection and password rejection. It explicitly disclaims application-data protection. [Fixture tests](../tests/helpers/pdfFixture.test.ts) verify missing/wrong synthetic passwords fail and the fixture password opens the document. Production code does not import it; [packaging](../desktop/packager.config.mjs) excludes tests and smoke harnesses. |
| 15 | False positive: deliberate negative control | The [HTTPS transport test](../server/mcp-http-transport.test.ts) temporarily sets `NODE_TLS_REJECT_UNAUTHORIZED=0` to prove a permissive parent cannot disable production certificate checks. It restores the environment in `finally`, expects refusal of its self-signed peer and verifies zero HTTP requests/bearer transmission. [Production transport](../server/mcpHttpTransport.ts) explicitly sets `rejectUnauthorized: true`. |
| 18 | False positive: non-disclosure assertion | [Credential smoke](../desktop/mcpCredentialSmoke.mjs) asserts that a fixture endpoint substring is **absent** from the public MCP response, alongside raw-secret/reference and structured-property checks. This does not admit, authorize or follow a URL. The smoke harness is excluded from the packaged product. |
| 19 | False positive: non-disclosure assertion | The [credential-vault test](../desktop/mcpCredentialVault.test.ts) asserts that `example.com` is **absent** from serialized vault bytes to prove binding metadata is encrypted. It does not use substring matching as a URL trust decision. Exact-bound read/restart behavior and private file modes are separately asserted. |

Existing focused hash/account/receipt suites passed **118 tests** under Node 26;
the legacy PDF fixture suite passed **4 tests**. Because those implementations
and tests remain unchanged, their disposition rests on the inspected semantics
and existing behavioral evidence, not a newly invented mutation claim.

The affected fixture/harness Node suites passed **105 tests**, including the
unchanged TLS-negative and vault non-disclosure checks. Mutations of the three
generic HTTP error responses, numeric OAuth port admission and DOCX namespace
matching each failed the intended assertion. After restoration, the affected
subset passed **59 tests**. These results do not claim packaged macOS smoke
acceptance or a complete browser run.

For alert 14, removing the origin refusal made the foreign preflight assertion
fail with expected 403 versus received 204. Restoring the guard made the full
focused pre-output-cancellation browser walk pass **1/1**.

## Dependency remediation and remaining upstream limitation

Dependabot **20**, [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249),
affected `minimatch` 10.2.6 in the development packaging toolchain. Its first
patched release is 11.0.1. The [lockfile](../package-lock.json) now resolves the
supported [ASAR 4.3.2 patch](https://github.com/electron/asar/releases/tag/v4.3.2),
whose release explicitly updates glob and minimatch:

| Component | Before | After |
|---|---|---|
| `@electron/packager` | 20.3.0 | 20.3.0 |
| `@electron/asar` | 4.3.0 | 4.3.2 |
| `glob` | 13.0.6 | 14.0.6 |
| `minimatch` | 10.2.6 | 11.0.9 |

The ASAR patch fits Packager's existing dependency range. Only its dependency
closure changes; [package.json](../package.json) gains no override or unrelated
upgrade. A clean `npm ci --ignore-scripts --no-audit --no-fund` passed with Node
26.13.1/npm 11.20.0. Real ASAR API checks passed for filesystem glob traversal,
hidden/nested/Unicode paths, native-file unpack selection, byte-exact reads and
full extraction. This is archive-tooling integration evidence, not a complete
native release build.

The full audit also identified high-severity
[GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),
published October 19 and reviewed/updated November 17, 2026. As of this review,
it affects `picomatch` through 4.0.7 and lists **no patched version**. Registry
metadata identifies 4.0.7 as the latest release; the advisory-linked
[upstream PR](https://github.com/micromatch/picomatch/pull/194) is still open.

This dependency was already present: Vite 6.4.6 uses `picomatch` 4.0.4 directly
and through `fdir` 6.5.0/`tinyglobby` 0.2.17. These versions do not change here.
`npm audit --json` reports four high package entries for that one advisory and
its affected ancestors. `npm audit --omit=dev --json` passes with **zero
production vulnerabilities**.

There are no direct product imports of `picomatch` or `tinyglobby` in the
reviewed source. [Vite configuration](../vite.config.ts) binds development to
`127.0.0.1` and uses repository-owned scan patterns; [desktop packaging](../desktop/packager.config.mjs)
excludes this development toolchain. This limits the observed exposure to
development/build tooling, without establishing that the vulnerable package
itself is safe.

The high advisory remains unresolved and must not be dismissed as fixed.
npm's suggested downgrade to Vite 6.2.7 was not applied because it abandons the
current 6.4.6 security-fix line. Upgrade when a compatible supported release
removes the affected `picomatch` range; verify the resolved lock, audit result,
build and required checks before landing that follow-up. No unreviewed fork or
unsupported override is substituted for an upstream fix.
