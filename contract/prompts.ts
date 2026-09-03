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
  /** The tenant that created it (F2/PD9). Unset ⇒ a seeded/shared entry visible to every
   *  tenant (the default toolkit is shared infra); a created one is private to its tenant. */
  tenantId?: string
  /** Server-owned ordering for the editable prompt definition (label, body, and
   *  target family). Viewer-default selection is an independent pointer and does
   *  not advance this revision. Legacy/seeded absence reads as zero. */
  definitionRevision?: number
  /** Human label, shown in the picker. */
  label: string
  /** Viewer-relative, stamped at serve time — never stored on the entity: this entry
   *  is the viewer's **default** prompt, pre-selected wherever one must be picked (the
   *  New-agent dialog). At most one per tenant; a pure UI shortcut (see
   *  `ModelProvider.isDefault` / `defaultEntry` — same semantics, same funnel): the
   *  API never resolves an absent id to it. Set/cleared via a create/patch request. */
  isDefault?: boolean
  /** The prompt text an Agent drives the model with — the resolved `Agent.systemPrompt`
   *  when an Agent is built from this entry. */
  body: string
  /** The model family this prompt was authored / tuned for (e.g. 'claude'). Compared
   *  to the chosen provider's `modelFamily` to flag a quiet downgrade. */
  targetFamily: string
}

/** One canonical ceiling for prompt-library text on every write path. */
export const MAX_SYSTEM_PROMPT_BODY_CHARS = 8000

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

/** Add a library prompt (the server mints the id). `isDefault: true` flags the new
 *  entry as the caller's default (moving the flag off any other entry). */
export type SystemPromptDefinitionFields = Pick<SystemPromptEntry, 'label' | 'body' | 'targetFamily'>
export type SystemPromptDefinitionPatch = Partial<SystemPromptDefinitionFields>
export type SystemPromptDefinitionMutationPatch = SystemPromptDefinitionPatch & { isDefault?: boolean }

export type CreateSystemPromptRequest = SystemPromptDefinitionFields & { isDefault?: boolean }

/** Patch a library prompt's fields. All optional — only the named fields change.
 *  `isDefault` moves/clears the caller's default flag (see `UpdateProviderRequest`). */
export type UpdateSystemPromptRequest = SystemPromptDefinitionMutationPatch & {
  /** Optional for compatibility with non-first-party callers. First-party edits
   *  always send it and therefore receive compare-and-swap protection. */
  expectedRevision?: number
}

/** Body of `DELETE /v1/system-prompts/:id`. First-party removal pins the
 * reusable prompt definition the person reviewed; omission preserves the
 * legacy unconditional-delete meaning for existing API clients. */
export interface DeleteSystemPromptRequest {
  expectedRevision?: number
}
