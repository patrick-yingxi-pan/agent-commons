/** Endpoint-owned catalogs: normalize optional metadata and publish only a
 * complete bounded enumeration. No model generation or selection fallback. */
import type { ModelInfo } from '../../contract/index.ts'

export type ProviderCatalogReader = (
  params: { limit: number; after_id?: string }, options: { signal: AbortSignal },
) => Promise<unknown>

const PAGE_SIZE = 100
const MAX_PAGES = 20
const MAX_ROWS = 2_000

interface WireModel {
  id?: string
  display_name?: string
  max_input_tokens?: number
  max_tokens?: number
  capabilities?: {
    effort?: { supported?: boolean } & Record<string, { supported?: boolean } | boolean | undefined>
    thinking?: { supported?: boolean; types?: { adaptive?: { supported?: boolean } } }
    image_input?: { supported?: boolean }
  }
}

const WIRE_EFFORTS: Array<[key: string, label: string]> = [
  ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'xHigh'], ['max', 'Max'],
]

/** Optional capabilities are never inferred from a model's name. Invalid rows
 * remain skippable; invalid pagination cannot masquerade as a complete list. */
function normalizeWireModel(value: unknown): ModelInfo | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const m = value as WireModel
  if (typeof m.id !== 'string' || !m.id) return undefined
  const caps = m.capabilities
  const efforts =
    caps?.effort?.supported === true
      ? WIRE_EFFORTS.filter(([k]) => {
          const level = caps.effort?.[k]
          return typeof level === 'object' && level?.supported === true
        }).map(([, label]) => label)
      : []
  const flags = {
    ...(typeof caps?.thinking?.supported === 'boolean' ? { thinking: caps.thinking.supported } : {}),
    ...(typeof caps?.thinking?.types?.adaptive?.supported === 'boolean' &&
      !(caps.thinking.supported === false && caps.thinking.types.adaptive.supported)
      ? { adaptiveThinking: caps.thinking.types.adaptive.supported } : {}),
    ...(typeof caps?.image_input?.supported === 'boolean' ? { vision: caps.image_input.supported } : {}),
  }
  return {
    id: m.id,
    label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id,
    ...(typeof m.max_input_tokens === 'number' && m.max_input_tokens > 0 ? { contextWindow: m.max_input_tokens } : {}),
    ...(typeof m.max_tokens === 'number' && m.max_tokens > 0 ? { maxOutputTokens: m.max_tokens } : {}),
    ...(Object.keys(flags).length ? { capabilities: flags } : {}),
    ...(efforts.length ? { effortLevels: efforts } : {}),
  }
}

/** Claude uses has_more/last_id, OpenAI's list is unpaginated. Legacy compatible
 * Messages endpoints may omit pagination on the first/only page, never after
 * promising a continuation. One caller-owned deadline covers every page;
 * the reader disables transport retries so SDK backoff cannot outlive it.
 * Any failed page or ambiguous duplicate discards the whole candidate so the
 * route cannot replace a working catalog with a prefix or clear a valid pick. */
export async function collectProviderModels(
  list: ProviderCatalogReader, protocol: 'anthropic-messages' | 'openai-responses', signal: AbortSignal,
): Promise<ModelInfo[] | undefined> {
  const models: ModelInfo[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let after_id: string | undefined
  let rows = 0
  try {
    for (let index = 0; index < MAX_PAGES; index++) {
      signal.throwIfAborted()
      const raw = await list({ limit: PAGE_SIZE, ...(after_id === undefined ? {} : { after_id }) }, { signal })
      signal.throwIfAborted()
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
      const page = raw as Record<string, unknown>
      if (!Array.isArray(page.data) || !page.data.length) return undefined
      rows += page.data.length
      if (rows > MAX_ROWS) return undefined
      for (const row of page.data) {
        const model = normalizeWireModel(row)
        if (!model) continue
        if (ids.has(model.id)) return undefined
        ids.add(model.id)
        models.push(model)
      }
      if (protocol === 'openai-responses' || page.has_more === false ||
        (index === 0 && page.has_more === undefined)) return models.length ? models : undefined
      if (page.has_more !== true) return undefined
      const cursor = page.last_id
      if (typeof cursor !== 'string' || !cursor.trim() || cursor.length > 512 || cursors.has(cursor) ||
        normalizeWireModel(page.data.at(-1))?.id !== cursor) return undefined
      cursors.add(cursor)
      after_id = cursor
    }
  } catch { /* Unavailable discovery never publishes a partial catalog or private diagnostics. */ }
  return undefined
}
