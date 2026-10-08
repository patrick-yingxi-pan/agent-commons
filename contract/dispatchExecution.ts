/** Explicit model selection for one-off Dispatch. These references do not
 * authorize execution; the server resolves and admits them against live state. */
export interface DispatchBinding {
  agentId: string
  providerId: string
  modelId: string
}

export interface RealDispatchInput {
  title: string
  detail?: string
  execution: DispatchBinding
}

export const DISPATCH_TITLE_MAX = 200
export const DISPATCH_DETAIL_MAX = 16_000
const DISPATCH_BINDING_ID_MAX = 200

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
}

function boundedNonblank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !!value.trim()
}

/** Strictly detach the exact user-reviewed Dispatch fields. No defaults,
 * coercion, live-registry lookup, or execution authority is implied. */
export function parseRealDispatchInput(value: unknown): RealDispatchInput | undefined {
  if (!record(value) || !hasExactKeys(value, ['title', 'execution'], ['detail']) ||
    !boundedNonblank(value.title, DISPATCH_TITLE_MAX) || !record(value.execution) ||
    !hasExactKeys(value.execution, ['agentId', 'providerId', 'modelId'])) return undefined

  if (Object.hasOwn(value, 'detail') &&
    (typeof value.detail !== 'string' || value.detail.length > DISPATCH_DETAIL_MAX)) return undefined

  const { agentId, providerId, modelId } = value.execution
  if (!boundedNonblank(agentId, DISPATCH_BINDING_ID_MAX) ||
    !boundedNonblank(providerId, DISPATCH_BINDING_ID_MAX) ||
    !boundedNonblank(modelId, DISPATCH_BINDING_ID_MAX)) return undefined

  return {
    title: value.title,
    ...(Object.hasOwn(value, 'detail') ? { detail: value.detail as string } : {}),
    execution: { agentId, providerId, modelId },
  }
}

/** The exact private prompt submitted for this dispatch. */
export function dispatchPrompt(title: string, detail?: string): string {
  const trimmedTitle = title.trim()
  const trimmedDetail = detail?.trim()
  return trimmedDetail ? `${trimmedTitle}\n\n${trimmedDetail}` : trimmedTitle
}
