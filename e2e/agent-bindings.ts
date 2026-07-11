import type { Page } from '@playwright/test'

/** POST /v1/agents is strict (INV-9): an agent must name a concrete registered
 *  provider and library system prompt — the API never resolves an absence to a
 *  registry entry on the caller's behalf. The convenience lives at the edge, so
 *  specs resolve the bindings the way a picker would: list the registries and take
 *  the pre-selected entry (the viewer's default flag, else the first). */
export async function agentBindings(page: Page): Promise<{ providerId: string; systemPromptId: string }> {
  const list = async (path: string): Promise<{ id: string; isDefault?: boolean }[]> => {
    const res = await page.request.get(path)
    if (!res.ok()) throw new Error(`GET ${path} failed (${res.status()}) — cannot resolve agent bindings`)
    const entries = (await res.json()) as { id: string; isDefault?: boolean }[]
    if (entries.length === 0) throw new Error(`GET ${path} returned no entries — cannot resolve agent bindings`)
    return entries
  }
  const pick = (entries: { id: string; isDefault?: boolean }[]) => (entries.find((e) => e.isDefault) ?? entries[0]).id
  const [providers, prompts] = await Promise.all([list('/api/v1/providers'), list('/api/v1/system-prompts')])
  return { providerId: pick(providers), systemPromptId: pick(prompts) }
}
