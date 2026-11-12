# Security policy

Agent Commons is under active development. Security fixes target the current
`main` branch; older revisions do not have a separate maintenance commitment.
The [release plan](docs/production-plan.md) and
[mock boundary](docs/spec/11-mock-boundary.md) describe the remaining acceptance
gates and which behavior is still a development fixture.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting form](https://github.com/patrick-yingxi-pan/agent-commons/security/advisories/new)
to report a suspected security vulnerability. Do not post exploit details,
credentials, or private workspace data in a public issue or pull request.

Include the affected commit or version, operating system, runtime profile
(`dev`, desktop, or web), reproduction steps using synthetic data, and the
expected security boundary and observed impact. Redact tokens, provider keys,
personal data, and unrelated logs. Test only systems and accounts you own or
have permission to assess.

Maintainers will use the private report to investigate and coordinate any fix
and disclosure with you. This project does not promise a response deadline or
operate a paid bug bounty. Ordinary bugs and feature requests belong in
[GitHub issues](https://github.com/patrick-yingxi-pan/agent-commons/issues).

## Development and deployment

The documented demo accounts and passwords are public fixtures. Keep the
development server local and do not use its seeded accounts for a public
deployment. Use the explicit runtime profiles and configuration described in
the [README](README.md#run-it). Choosing a release profile does not erase an
existing demo database; use a separate clean database for a clean first run.

Keep real credentials and user data out of commits, reports, and screenshots.
If a credential is exposed, revoke or rotate it at its issuer; removing it from
a later commit does not invalidate copies already disclosed.
