import { posix } from 'node:path'

/** Fixed data-admission limits for a future native stdio supervisor.
 * These limits do not authorize launching, sandbox a process, or attest to the
 * identity/integrity of the selected executable. */
export const MCP_STDIO_LAUNCH_LIMITS = Object.freeze({
  maxExecutableBytes: 4_096,
  maxCwdBytes: 4_096,
  maxArgs: 64,
  maxArgBytes: 8_192,
  maxEnvEntries: 64,
  maxEnvValueBytes: 8_192,
  maxTotalArgEnvBytes: 65_536,
})

const dangerousEnvironmentKeys = new Set(['__proto__', 'prototype', 'constructor'])
const fail = () => null

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function dataDescriptor(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get !== undefined || descriptor.set !== undefined) return undefined
  return descriptor
}

function validString(value, limit) {
  if (typeof value !== 'string' || value.includes('\0') || !isWellFormed(value)) return undefined
  const bytes = Buffer.byteLength(value, 'utf8')
  return bytes <= limit ? bytes : undefined
}

function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

function absolutePath(value, limit) {
  const bytes = validString(value, limit)
  if (bytes === undefined || value.length === 0) return undefined
  return posix.isAbsolute(value) ? bytes : undefined
}

function snapshotArgs(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined
  const keys = Reflect.ownKeys(value)
  const lengthDescriptor = dataDescriptor(value, 'length')
  const length = lengthDescriptor?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > MCP_STDIO_LAUNCH_LIMITS.maxArgs ||
      keys.length !== length + 1 || keys.some(key => typeof key !== 'string' ||
        (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) return undefined
  const result = []
  let bytes = 0
  for (let index = 0; index < length; index += 1) {
    const descriptor = dataDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable) return undefined
    const stringBytes = validString(descriptor.value, MCP_STDIO_LAUNCH_LIMITS.maxArgBytes)
    if (stringBytes === undefined) return undefined
    // Include one terminator per argument in the aggregate process-input bound.
    bytes += stringBytes + 1
    if (bytes > MCP_STDIO_LAUNCH_LIMITS.maxTotalArgEnvBytes) return undefined
    result.push(descriptor.value)
  }
  return { value: Object.freeze(result), bytes }
}

function snapshotEnvironment(value, priorBytes) {
  if (!plainRecord(value)) return undefined
  const keys = Reflect.ownKeys(value)
  if (keys.length > MCP_STDIO_LAUNCH_LIMITS.maxEnvEntries || keys.some(key => typeof key !== 'string')) return undefined
  const result = {}
  let bytes = priorBytes
  for (const key of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || dangerousEnvironmentKeys.has(key)) return undefined
    const descriptor = dataDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable) return undefined
    const keyBytes = validString(key, 128)
    const valueBytes = validString(descriptor.value, MCP_STDIO_LAUNCH_LIMITS.maxEnvValueBytes)
    if (keyBytes === undefined || valueBytes === undefined) return undefined
    // Include `=` plus the process environment's NUL terminator per entry.
    bytes += keyBytes + valueBytes + 2
    if (bytes > MCP_STDIO_LAUNCH_LIMITS.maxTotalArgEnvBytes) return undefined
    result[key] = descriptor.value
  }
  return { value: Object.freeze(result), bytes }
}

/** Admit a detached, immutable native launch description without executing or
 * normalizing it. No ambient environment, shell, filesystem, or process state
 * is consulted. Invalid input yields only null. */
export function snapshotMcpStdioLaunch(value) {
  try {
    if (!plainRecord(value)) return fail()
    const keys = Reflect.ownKeys(value)
    if (keys.length !== 4 || keys.some(key => typeof key !== 'string' ||
        !['executable', 'args', 'cwd', 'env'].includes(key))) return fail()
    const executable = dataDescriptor(value, 'executable')
    const argsDescriptor = dataDescriptor(value, 'args')
    const cwd = dataDescriptor(value, 'cwd')
    const envDescriptor = dataDescriptor(value, 'env')
    if (![executable, argsDescriptor, cwd, envDescriptor].every(descriptor => descriptor?.enumerable)) return fail()
    const executableBytes = absolutePath(executable.value, MCP_STDIO_LAUNCH_LIMITS.maxExecutableBytes)
    const cwdBytes = absolutePath(cwd.value, MCP_STDIO_LAUNCH_LIMITS.maxCwdBytes)
    if (executableBytes === undefined || cwdBytes === undefined) return fail()
    const args = snapshotArgs(argsDescriptor.value)
    if (!args) return fail()
    const env = snapshotEnvironment(envDescriptor.value, args.bytes)
    if (!env) return fail()
    return Object.freeze({ executable: executable.value, args: args.value, cwd: cwd.value, env: env.value })
  } catch {
    return fail()
  }
}
