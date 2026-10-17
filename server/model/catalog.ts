/** ── The mock endpoint's model catalog (one source, two faces) ───────────────
 *  The models the mock Anthropic endpoint serves. ONE record set derives BOTH
 *  faces so they can't drift:
 *    • `wireModels()` — the Anthropic `GET /v1/models` wire shape (id /
 *      display_name / created_at / max_input_tokens / max_tokens / capabilities
 *      with per-level effort + thinking + image_input), served by
 *      server/model/index.ts exactly the way api.anthropic.com answers;
 *    • `seedModels()` — the contract's normalized `ModelInfo[]`, carried by the
 *      seeded default provider (server/data/providers.ts).
 *  The backend's `fetchProviderModels` (server/generate.ts) normalizes the wire
 *  face back into `ModelInfo`, so a live refresh of the default provider
 *  round-trips to exactly `seedModels()` — locked by server/model/provider-models.test.ts. */
import type { ModelInfo } from '../../contract/index.ts'

/** The canonical effort ladder order (the Anthropic capability keys, low→max). */
export const EFFORT_KEYS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** Display labels for the ladder, index-aligned with EFFORT_KEYS. */
export const EFFORT_LABELS = ['Low', 'Medium', 'High', 'xHigh', 'Max'] as const

interface CatalogEntry {
  id: string
  label: string
  createdAt: string
  contextWindow: number
  maxOutputTokens: number
  /** Which effort levels the model supports (subset of EFFORT_KEYS); empty = the
   *  model declares no effort support, suppressing provider-level overrides. */
  efforts: readonly (typeof EFFORT_KEYS)[number][]
  thinking: boolean
  vision: boolean
}

/** The trio, richest-first (the real API lists newest first). Deliberately varied
 *  so every degradation path is exercised: Opus carries the full 5-level ladder +
 *  the 1M window; Sonnet a 3-level ladder + 200k; Haiku declares no effort levels
 *  at all (an explicitly empty vocabulary). */
const CATALOG: CatalogEntry[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', createdAt: '2025-12-02T00:00:00Z', contextWindow: 1_000_000, maxOutputTokens: 64_000, efforts: EFFORT_KEYS, thinking: true, vision: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', createdAt: '2025-09-29T00:00:00Z', contextWindow: 200_000, maxOutputTokens: 64_000, efforts: ['low', 'medium', 'high'], thinking: true, vision: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', createdAt: '2025-10-01T00:00:00Z', contextWindow: 200_000, maxOutputTokens: 32_000, efforts: [], thinking: false, vision: true },
]

/** The Anthropic `/v1/models` wire face — what the mock endpoint answers. */
export function wireModels(): unknown[] {
  return CATALOG.map((m) => ({
    id: m.id,
    display_name: m.label,
    created_at: m.createdAt,
    type: 'model',
    max_input_tokens: m.contextWindow,
    max_tokens: m.maxOutputTokens,
    capabilities: {
      effort: {
        supported: m.efforts.length > 0,
        ...Object.fromEntries(EFFORT_KEYS.map((k) => [k, { supported: m.efforts.includes(k) }])),
      },
      thinking: { supported: m.thinking },
      image_input: { supported: m.vision },
    },
  }))
}

/** The normalized contract face — the seeded default provider's catalog. */
export function seedModels(): ModelInfo[] {
  return CATALOG.map((m) => ({
    id: m.id,
    label: m.label,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    capabilities: { thinking: m.thinking, vision: m.vision },
    effortLevels: m.efforts.map((k) => EFFORT_LABELS[EFFORT_KEYS.indexOf(k)]),
  }))
}
