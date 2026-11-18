# CLAUDE.md

Load [`AGENTS.md`](AGENTS.md). It is the always-on repository map and contains
the top-level rule index, start/verify commands, and read-on-demand routing.

Essentials: Node 26+, `npm run dev` at `http://127.0.0.1:5173`, ship tests and
spec rows with changes, review the diff, then push a branch and open a pull
request to `main`. GitHub requires the complete verifier and security checks
to pass before merge. Running `npm run verify` locally is optional.
UI review ends signed in as Ada.

Directory-scoped `CLAUDE.md` files refine the top-level rules. Long rationale
lives in `DESIGN.md`, `SPEC.md`, and `docs/` companions and is loaded only when
the relevant rule changes.
