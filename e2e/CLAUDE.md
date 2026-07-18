# e2e/ — browser E2E conventions (loaded when working under e2e/)

The always-on map is [`AGENTS.md`](../AGENTS.md).

`npm run e2e` needs the browser once: `npx playwright install chromium`. It
drives the **rendered UI** (the layer `node --test` can't — no DOM), booting
its **own** stack on dedicated ports (UI 5183 / API 5184 — it never reuses a
running dev server, whose mode and store can't be trusted) with an isolated
store (`DATA_FILE=.data/e2e-store.json`), `BACKEND=remote` (so Playwright
browser contexts impersonate **tenants** via the identity headers), and a
pinned local `ANTHROPIC_BASE_URL` (an ambient one would stand the mock model
down). The store/route suites lock the logic; the E2E locks the wiring.

Anchor specs:

- `e2e/co-author-article.spec.ts` — the two-tenant multi-tenancy regression.
- `e2e/account-switch.spec.ts` — the switch-mid-generation crux of
  `docs/design/multi-account-ui.md`; the in-app account switcher is live.
- `e2e/auth-wizard.spec.ts` + `e2e/onboarding.spec.ts` — the §12 front door:
  the full-screen sign-up wizard and the multi-account stack.
- `e2e/responsive.spec.ts` — the viewport ladder at phone/tablet/landscape
  sizes: the narrow-tier rail drawer, the full-viewport panel takeover, and
  the `short:` chrome compression (spec ADAPT-11).

Spec gotchas: the app **opens on a fresh draft** (sending materializes a new
session), and the sidebar is an `<aside>` (role `complementary`) — only its
nav buttons carry a `navigation` role.
