# Contributing to Agent Commons

Bug reports, reproducible examples, and proposed improvements are welcome in
[GitHub issues](https://github.com/patrick-yingxi-pan/agent-commons/issues).
Keep credentials and private workspace or customer data out of issues and pull
requests.

For suspected security vulnerabilities, follow the private reporting process in
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Licensing of contributions

Agent Commons offers its original code under AGPLv3 only. Read
[LICENSING.md](LICENSING.md) and [LICENSE](LICENSE) before contributing code or
documentation.

By submitting a contribution, you agree to license your original contribution
under AGPLv3 only (`AGPL-3.0-only`). Contributors retain their copyrights.
No separate contributor agreement or copyright assignment is required.
No additional rights to relicense contributions under proprietary terms are
requested.

Contribute only material you have the right to submit, including any necessary
authorization from your employer or another copyright holder. Disclose third-party
code and its license, and preserve its notices. Third-party material retains its
own terms; maintainers must review license compatibility before merging.

This policy does not revoke rights already granted under separately executed
agreements.

## Development and review

The [README](README.md) explains setup. Use Node 26 or newer, install the locked
dependencies with `npm ci`, and read [AGENTS.md](AGENTS.md) plus the scoped context
for the part of the repository you are changing.

Use the normal `npm ci` lifecycle for development. Its installation hook guards
the build toolchain against a `picomatch` advisory. If you installed with
`--ignore-scripts`, repeat `npm ci` before starting the dev server or building.
See the [mitigation and upgrade instructions](docs/security-alert-review-2026-11-17.md#temporary-mitigation-for-the-picomatch-advisory).

Keep changes focused, include regression checks for behavioral changes, and update
the relevant requirement in `docs/spec/`. Review the diff and open a pull
request targeting `main`. Running the complete `npm run verify` locally before
pushing is optional. GitHub runs the full verifier in `Checks` and `E2E 1/6`
through `E2E 6/6`. Those jobs, `Dependency review`, and the CodeQL merge rule
must pass before merging. Resolve review conversations and keep the branch
up to date. See the [delivery policy](docs/agent-workflow.md) for review and
acceptance requirements.
