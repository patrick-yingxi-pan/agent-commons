/** Strict, bounded JSON snapshots at the untrusted MCP seam. Never invokes
 * getters/toJSON, silently drops values, or retains caller-owned references. */
export type McpJsonValue = null | boolean | number | string | McpJsonValue[] | { [key: string]: McpJsonValue }
export class McpJsonError extends Error {
  constructor() { super('Invalid or oversized MCP JSON.'); this.name = 'McpJsonError' }
}

export function snapshotMcpJson(value: unknown, limits: { maxBytes: number; maxDepth: number; maxNodes: number }): McpJsonValue {
  const reject = (): never => { throw new McpJsonError() }
  if (['maxBytes', 'maxDepth', 'maxNodes'].some((key) => {
    const limit = limits[key as keyof typeof limits]
    return !Number.isSafeInteger(limit) || limit < 1
  }) ||
    limits.maxDepth > 128) reject()
  const encoder = new TextEncoder()
  let bytes = 0
  let nodes = 0
  const charge = (size: number) => { bytes += size; if (bytes > limits.maxBytes) reject() }
  const quote = (text: string) => {
    // Every UTF-16 unit costs at least one byte when represented in JSON.
    if (text.length > limits.maxBytes - bytes) reject()
    charge(encoder.encode(JSON.stringify(text)).byteLength)
  }
  const visit = (item: unknown, depth: number): McpJsonValue => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) reject()
    if (item === null) { charge(4); return null }
    if (typeof item === 'string') { quote(item); return item }
    if (typeof item === 'boolean') { charge(item ? 4 : 5); return item }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) reject()
      charge(JSON.stringify(item).length)
      return item === 0 ? 0 : item
    }
    if (typeof item !== 'object' || !item) return reject()
    if (Object.getOwnPropertySymbols(item).length) reject()
    if (Array.isArray(item)) {
      if (item.length > limits.maxNodes - nodes) reject()
      // Sparse arrays, accessors and custom properties are not JSON values.
      const keys = Object.getOwnPropertyNames(item)
      if (keys.length !== item.length + 1) reject()
      charge(2 + Math.max(0, item.length - 1))
      const result: McpJsonValue[] = []
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject()
        result.push(visit(descriptor!.value, depth + 1))
      }
      return result
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) reject()
    const keys = Object.getOwnPropertyNames(item)
    if (keys.length > limits.maxNodes - nodes) reject()
    charge(2 + Math.max(0, keys.length - 1))
    const result: { [key: string]: McpJsonValue } = {}
    for (const key of keys) {
      quote(key)
      charge(1)
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject()
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
    }
    return result
  }
  try { return visit(value, 1) } catch { return reject() }
}
