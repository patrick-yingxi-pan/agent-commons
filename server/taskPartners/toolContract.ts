import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

type Schema = Record<string, unknown>
type Operation = { summary: string; requestBody?: { required?: boolean; content: { 'application/json'?: { schema: Schema } } } }
type Protocol = { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } }
type ToolContract = { summary: string; body?: Schema; bodyRequired?: boolean }

let protocol: Protocol | undefined
const contracts = new Map<string, ToolContract>()
/** MCP tool schemas must stand alone. Resolve local schema references and omit
 * example payloads so every model sees the same shape as an HTTP integrator. */
function inputSchema(value: Schema, schemas: Record<string, Schema>): Schema {
  const reference = value.$ref
  if (typeof reference === 'string') {
    const name = reference.slice('#/components/schemas/'.length)
    if (!reference.startsWith('#/components/schemas/') || !schemas[name]) throw new Error('Unresolved task partner schema: ' + reference)
    return inputSchema(schemas[name], schemas)
  }
  const result: Schema = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'properties') {
      result.properties = Object.fromEntries(Object.entries(entry as Record<string, Schema>).map(([k, v]) => [k, inputSchema(v, schemas)]))
    } else if (key === 'items' || (key === 'additionalProperties' && typeof entry === 'object' && entry)) {
      result[key] = inputSchema(entry as Schema, schemas)
    } else if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      result[key] = (entry as Schema[]).map(s => inputSchema(s, schemas))
    } else if (!['example', 'examples', 'default'].includes(key)) result[key] = entry
  }
  return result
}
export function partnerToolContract(method: string, pattern: string): ToolContract | undefined {
  if (!pattern.startsWith('/task-partners/') && pattern !== '/projects/:id/task-drafts' && !pattern.startsWith('/projects/:id/work/:workId/')) return
  const key = method + ' ' + pattern
  const saved = contracts.get(key)
  if (saved) return saved
  protocol ??= JSON.parse(readFileSync(fileURLToPath(new URL('../../docs/design/task-partner-api.openapi.json', import.meta.url)), 'utf8')) as Protocol
  const path = pattern.replace('/task-partners/:environment/', '/').replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}')
  const op = protocol.paths[path]?.[method.toLowerCase()]
  if (!op) throw new Error('Missing OpenAPI definition for ' + key)
  const schema = op.requestBody?.content['application/json']?.schema
  const contract = { summary: op.summary, ...(schema && { body: inputSchema(schema, protocol.components.schemas), bodyRequired: op.requestBody?.required === true }) }
  contracts.set(key, contract)
  return contract
}
