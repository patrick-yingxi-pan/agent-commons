# server/model/ — the model seam (loaded when working under server/model/)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## What lives here

The **dev mock of an Anthropic-compatible endpoint** — not an in-process fake
of the backend's own generation. `index.ts` serves `POST /v1/messages` speaking
the real Messages wire format (JSON + streaming SSE, `tool_use` blocks and all);
`intents.ts` decides which tools a message should call (fixed-string / keyword
matching); `replies.ts` wraps canned prose around them; `tools.ts` declares the
resource-manipulation tool surface; `apiTools.ts` is the in-app leg of access
parity; `connectorTools.ts` the session-relay leg; `catalog.ts` the provider /
model catalog.

Beside them, the suites that lock each. `server/generate.ts` — the *client* of
this endpoint — stays at the server root, and its suites sit next to it there:
the boundary is the point, so the two sides do not share a directory.

## Rules

- **This is a seam, not a shortcut.** Going live is `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_API_KEY` and nothing more. Anything added here that the real API
  would not also do is a shortcut a production system would have to unwind —
  the one thing this repo's architecture is arguing against.
- **Tool calls are the protocol, not an overlay.** Resource manipulations reach
  the backend as Messages-API `tool_use` blocks that the backend executes and
  surfaces as consent-gated proposals. Never add a backend keyword branch that
  bypasses the tool loop.
- **The tool surface is GENERATED from the route table** (`server/apiSurface.ts`
  over `Router.list()`), so a new route is a new tool with no second list to
  update. Never hand-add a generated tool with its own logic. Non-product form,
  semantic alias, and session-intrinsic realizations are declared with a reason
  on the route itself (access parity, INV-11 —
  [`docs/mcp-access.md`](../../docs/mcp-access.md)); there is no model-private
  exclusion list.
