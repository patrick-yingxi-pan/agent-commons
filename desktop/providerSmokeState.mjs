/** Read-only acceptance observer shared by the two native provider protocols.
 * This helper never ships and never injects into a running product store. */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export function readProviderState(profile, providerId, sessionId, tenantId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const entity = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?')
    const entry = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?')
    const parse = row => row ? JSON.parse(row.json) : undefined
    return {
      provider: parse(entry.get('providers', providerId)),
      config: parse(entry.get('providerConfigs', providerId)),
      session: parse(entity.get('sessions', sessionId)),
      usage: parse(entry.get('usageMeters', tenantId)),
      productJson: database.prepare(`
        SELECT json FROM entities UNION ALL SELECT json FROM map_entries
        UNION ALL SELECT json FROM kv UNION ALL SELECT image_json AS json FROM image_assets
        UNION ALL SELECT original_json AS json FROM image_assets WHERE original_json IS NOT NULL
      `).all().map(row => row.json).join('\n'),
    }
  } finally { database.close() }
}
