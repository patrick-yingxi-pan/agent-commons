/** ── Contract: the system-prompt library (D10) ──────────────────────────────
 *  A reusable, named system prompt a user picks for an Agent instead of writing one
 *  from scratch (docs/agent-commons.md, D10). System prompts are *provider-optimized,
 *  not portable text*, so each entry is tagged with the model family it was authored
 *  for. The compatibility of any actual use is a verdict on the **(prompt × selected
 *  provider model)** pairing — surfaced as a non-blocking downgrade *warning* at
 *  selection time, not a silent application of a Claude-tuned prompt to a small open
 *  model. The prompt library is the *cognition* half of the Agent bundle; the Model
 *  provider is the *substrate* half; the tag is the typed compatibility edge between
 *  them. */

export interface SystemPromptEntry {
  id: string
  /** Human label, shown in the picker. */
  label: string
  /** The prompt text an Agent drives the model with — the resolved `Agent.systemPrompt`
   *  when an Agent is built from this entry. */
  body: string
  /** The model family this prompt was authored / tuned for (e.g. 'claude'). Compared
   *  to the chosen provider's `modelFamily` to flag a quiet downgrade. */
  targetFamily: string
}

/** The D10 fit check — pure and shared (like `overBudgetWindow`), so the picker can
 *  warn client-side and the server can assert the same verdict. Returns a human
 *  downgrade warning when the prompt's authored-for family differs from the provider's
 *  model family, or `null` when they match (a good pairing). **Non-blocking by
 *  design**: a mismatch warns, it does not forbid — the legitimate "this prompt
 *  happens to port fine" case must stay open (D10 rejected a blocking probe as the
 *  default). */
export function promptFitWarning(entry: SystemPromptEntry, providerModelFamily: string): string | null {
  if (entry.targetFamily === providerModelFamily) return null
  return `Authored for ${entry.targetFamily} models — may degrade on a ${providerModelFamily} provider.`
}

/** Add a library prompt (the server mints the id). */
export type CreateSystemPromptRequest = Omit<SystemPromptEntry, 'id'>

/** Patch a library prompt's fields. All optional — only the named fields change. */
export type UpdateSystemPromptRequest = Partial<Omit<SystemPromptEntry, 'id'>>
