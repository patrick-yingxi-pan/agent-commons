/** Strict, bounded JSON snapshots at the untrusted MCP seam. Never invokes
 * getters/toJSON, silently drops values, or retains caller-owned references. */
export class McpJsonError extends Error {
  constructor(code = 'invalid') {
    super('Invalid or oversized MCP JSON.')
    this.name = 'McpJsonError'
    this.code = code
  }
}

export function snapshotMcpJson(value, limits) {
  const reject = (code = 'invalid') => { throw new McpJsonError(code) }
  if (['maxBytes', 'maxDepth', 'maxNodes'].some((key) => {
    const limit = limits[key]
    return !Number.isSafeInteger(limit) || limit < 1
  }) || limits.maxDepth > 128) reject()
  const encoder = new TextEncoder()
  let bytes = 0
  let nodes = 0
  const charge = (size) => { bytes += size; if (bytes > limits.maxBytes) reject('limit') }
  const quote = (text) => {
    // Every UTF-16 unit costs at least one byte when represented in JSON.
    if (text.length > limits.maxBytes - bytes) reject('limit')
    charge(encoder.encode(JSON.stringify(text)).byteLength)
  }
  const visit = (item, depth) => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) reject('limit')
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
      if (item.length > limits.maxNodes - nodes) reject('limit')
      // Sparse arrays, accessors and custom properties are not JSON values.
      const keys = Object.getOwnPropertyNames(item)
      if (keys.length !== item.length + 1) reject()
      charge(2 + Math.max(0, item.length - 1))
      const result = []
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject()
        result.push(visit(descriptor.value, depth + 1))
      }
      return result
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) reject()
    const keys = Object.getOwnPropertyNames(item)
    if (keys.length > limits.maxNodes - nodes) reject('limit')
    charge(2 + Math.max(0, keys.length - 1))
    const result = {}
    for (const key of keys) {
      quote(key)
      charge(1)
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject()
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
    }
    return result
  }
  try { return visit(value, 1) } catch (error) { if (error instanceof McpJsonError) throw error; return reject() }
}
