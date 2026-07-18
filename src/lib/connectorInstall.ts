/** ── The bootstrap prompt (spec MODEL-22) ─────────────────────────────────────
 *  ONE source of truth for the single artifact the mint panel hands the user: a
 *  prompt they paste into the AI session that will do the thinking. The v4
 *  onboarding inversion (docs/delegated-cognition-provider.md §9.3): the UI no
 *  longer enumerates harness-specific install commands (a Claude-CLI recipe
 *  silently excluded Codex / Cursor / opencode / any harness we've never heard
 *  of — the opposite of the connector's last-resort purpose). Instead the
 *  far AGENT onboards itself: the prompt points it at the agent-facing setup
 *  guide (`GET /connector/setup`, server/connectorSetup.ts), where every
 *  harness-specific instruction now lives — install the MCP connector its own
 *  way, or drive the relay protocol directly with plain HTTP.
 *
 *  This prompt CARRIES THE SECRET, and that is the whole point: it is the single
 *  place the credential is ever displayed (the one-credential/one-place rule the
 *  old connect sentence established). One artifact to copy, one thing to save.
 *  Locked by tests/connector-serve.test.ts. */
export function bootstrapPrompt(relayUrl: string, secret: string): string {
  return (
    `You're going to serve as the model behind one of my providers. Fetch ${relayUrl}/connector/setup and follow it: ` +
    `set yourself up (install its relay connector into your own harness, or drive the relay protocol directly), then ` +
    `connect to ${relayUrl} with secret ${secret} and start draining. The secret is a password — use it only against ` +
    `that relay, and keep the loop running until I say stop.`
  )
}
