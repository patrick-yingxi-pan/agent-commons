# CLAUDE.md

This is an **independent UI/UX proposal prototype** for unifying the Claude
desktop app's Chat / Cowork / Code tabs into one adaptive conversation. Not
affiliated with or endorsed by Anthropic; all data is mocked.

Full agent context — quick start, how to verify, and an **evaluation guide** —
lives in the shared agent file:

@AGENTS.md

Essentials:

- **Run:** `npm run dev` (Node 26+) → http://127.0.0.1:5173, then **Play the
  guided tour**.
- **Ship tests with every feature:** a change isn't done until `tests/` lock its
  behavior against regression (see `AGENTS.md` conventions).
- **Verify:** `npm run typecheck`, `node --test` (and `npm run build`) before
  declaring a change done; verify UI changes in the running app.
- **The contract is load-bearing:** `contract/*.ts` is imported verbatim by both
  the UI and the server — don't break that type-identity.
- **Mock by design:** no real model; seed data in `server/data/`. Don't file
  intentional mock behavior as bugs.
- **Git:** commit and push straight to `main` over HTTPS.
- **Design decisions (locked in):** light theme only (no dark mode), no "before"
  view, and the dev server binds IPv4 (`127.0.0.1`). See `AGENTS.md` for the why.
