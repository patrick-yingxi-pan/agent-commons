/** ── Contract: the opt-in prompt-fit probe (docs/agent-commons.md, D10 / OQ5) ────
 *  The static target-family **tag** (`promptFitWarning`) stays the always-on default
 *  fit signal. This is the *optional later upgrade* D10 named and OQ5 resolved to keep
 *  optional: a selection-time **conformance probe** that is strictly more accurate than
 *  the binary tag — it returns a SCORE and a per-aspect breakdown (which dimensions
 *  degrade), not just "warn / don't". Opt-in because, in production, it costs a model
 *  call: a real probe runs a small **tool-use conformance check** against the chosen
 *  model; the mock fulfils it with a deterministic score. The seam is real either way. */

/** The aspects a probe scores — the dimensions a Claude-tuned prompt can degrade on when
 *  run against a follower model. The static tag collapses these into one binary signal. */
export const PROBE_ASPECTS = ['tool-use fidelity', 'consent-gate adherence', 'instruction-following'] as const
export type ProbeAspectName = (typeof PROBE_ASPECTS)[number]

export interface ProbeAspect {
  name: ProbeAspectName
  /** 0–100 — how well this dimension holds for the (prompt × model) pairing. */
  score: number
}

/** A coarse verdict derived from the overall score — the picker's badge. */
export type ProbeVerdict = 'strong' | 'fair' | 'weak'

/** Probe a system prompt against a chosen provider's model family. The prompt is named in
 *  the route path; the body carries only the provider to probe against (absent ⇒ the
 *  default provider's family). */
export interface PromptProbeRequest {
  providerId?: string
}

export interface PromptProbeResult {
  /** 0–100 overall conformance — the mean of the aspect scores. */
  score: number
  verdict: ProbeVerdict
  /** Per-aspect sub-scores — the added signal over the binary tag. */
  aspects: ProbeAspect[]
  /** A one-line human summary naming the weak point on a mismatch. */
  detail: string
}

/** The pure scorer — deterministic from the (prompt-authored-for × selected-model) family
 *  pairing, so the mock reproduces identically and a test can assert it. A real probe would
 *  replace this body with a model conformance check; the shape it returns is the contract.
 *  A matched pairing scores high across the board; a mismatch degrades most on **tool-use
 *  fidelity** (follower models ape `tool_use` least reliably) and least on plain
 *  instruction-following — exactly the gradient the binary tag can't express. */
export function probeScore(targetFamily: string, modelFamily: string): PromptProbeResult {
  const match = targetFamily.trim().toLowerCase() === modelFamily.trim().toLowerCase()
  const aspects: ProbeAspect[] = match
    ? PROBE_ASPECTS.map((name) => ({ name, score: 96 }))
    : [
        { name: 'tool-use fidelity', score: 52 },
        { name: 'consent-gate adherence', score: 67 },
        { name: 'instruction-following', score: 78 },
      ]
  const score = Math.round(aspects.reduce((sum, a) => sum + a.score, 0) / aspects.length)
  const verdict: ProbeVerdict = score >= 85 ? 'strong' : score >= 65 ? 'fair' : 'weak'
  const detail = match
    ? `Authored for ${targetFamily} and running on ${modelFamily} — a matched pairing.`
    : `Authored for ${targetFamily} but running on ${modelFamily} — tool-use fidelity is the weak point.`
  return { score, verdict, aspects, detail }
}
