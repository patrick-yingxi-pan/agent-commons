# Contributing to Agent Commons

Bug reports, reproducible examples, and proposed improvements are welcome in
[GitHub issues](https://github.com/patrick-yingxi-pan/agent-commons/issues).
Keep credentials and private workspace or customer data out of issues and pull
requests.

## Licensing of contributions

Agent Commons offers its original code under AGPLv3 only, with a separate paid
commercial option. Read [LICENSING.md](LICENSING.md) and [LICENSE](LICENSE) before
contributing code or documentation.

Before an outside copyrightable contribution is merged, the maintainer must have
documented permission to distribute that contribution under both AGPLv3 and
separate commercial terms. Contact Patrick Pan through an issue or the pull
request to arrange a separate written contributor agreement before acceptance.
That agreement must cover the necessary licensing and sublicensing rights for
both options; submitting a pull request alone does not supply those extra rights.
There is no automatic copyright assignment in these contribution guidelines.

Contribute only material you have the right to submit. Identify any employer or
other party whose authorization is needed, and disclose third-party code and its
license. Preserve third-party notices. Maintainers must review compatibility and
record the applicable permissions before merging; an AGPL-only contribution
cannot simply be included in a proprietary commercial grant.

This is a contribution policy, not the contributor agreement itself. Existing
contributors' rights are not changed by adding this file.

## Development and review

The [README](README.md) explains setup. Use Node 26 or newer, install the locked
dependencies with `npm ci`, and read [AGENTS.md](AGENTS.md) plus the scoped context
for the part of the repository you are changing.

Keep changes focused, include regression checks for behavioral changes, and update
the relevant requirement in `docs/spec/`. Follow the verification and review
procedure in [docs/agent-workflow.md](docs/agent-workflow.md), including the complete
local `npm run verify` before landing. Describe what changed and which checks
passed in the pull request.
