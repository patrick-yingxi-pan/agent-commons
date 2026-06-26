/** ── Model + effort catalog ─────────────────────────────────────────────────
 *  One source of truth for the Claude models and the reasoning-effort ladder, so
 *  the composer's Model control and the scheduled-routine Model picker pick from
 *  the same list. A routine stores its model as a label string ("Claude Opus 4.8 ·
 *  High"); compose/parse bridge that string and the structured choice. Pure +
 *  framework-free (no React) so the bridges are unit-tested. */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ModelId = 'opus' | 'sonnet' | 'haiku'

export const MODELS = [
  { id: 'opus', name: 'Claude Opus 4.8', short: 'Opus 4.8', blurb: 'Most capable — best for hard reasoning & code.', isOpus: true },
  { id: 'sonnet', name: 'Claude Sonnet 4.6', short: 'Sonnet 4.6', blurb: 'Fast and balanced for everyday work.', isOpus: false },
  { id: 'haiku', name: 'Claude Haiku 4.5', short: 'Haiku 4.5', blurb: 'Fastest — for lightweight tasks.', isOpus: false },
] as const

export const EFFORTS: { id: Effort; label: string; blurb: string }[] = [
  { id: 'low', label: 'Low', blurb: 'Quick replies, minimal reasoning.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced speed and depth.' },
  { id: 'high', label: 'High', blurb: 'Deeper, step-by-step reasoning.' },
  { id: 'xhigh', label: 'xHigh', blurb: 'Extended reasoning for hard, multi-file work.' },
  { id: 'max', label: 'Max', blurb: 'Maximum reasoning for the hardest problems.' },
]

/** The routine's stored model label, e.g. "Claude Opus 4.8 · High". */
export function composeModelLabel(modelId: ModelId, effort: Effort): string {
  const m = MODELS.find((x) => x.id === modelId) ?? MODELS[0]
  const e = EFFORTS.find((x) => x.id === effort) ?? EFFORTS[2]
  return `${m.name} · ${e.label}`
}

/** Best-effort parse of a stored model label back into the structured choice, so a
 *  picker opens pre-selected. Falls back to Opus · High (the product default) for
 *  anything unrecognized — never throws. */
export function parseModelLabel(label: string): { modelId: ModelId; effort: Effort } {
  const model = MODELS.find((m) => label.includes(m.name) || label.includes(m.short))
  const effort = EFFORTS.find((e) => new RegExp(`·\\s*${e.label}\\b`, 'i').test(label))
  return { modelId: model?.id ?? 'opus', effort: effort?.id ?? 'high' }
}
