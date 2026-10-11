import type { McpStdioLaunch } from '../../contract/mcpStdioSetup.ts'

export interface McpStdioLaunchDraft { executable: string; argumentsJson: string; cwd: string; environmentJson: string }
export const EMPTY_MCP_STDIO_DRAFT: McpStdioLaunchDraft = { executable: '', argumentsJson: '[]', cwd: '', environmentJson: '{}' }
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const textBytes = (value: unknown, limit: number): value is string => typeof value === 'string' && !value.includes('\0') && decoder.decode(encoder.encode(value)) === value && encoder.encode(value).length <= limit

/** JSON only, never command-line splitting, interpolation or shell expansion.
 * This is input guidance; the native host independently validates every byte. */
export function parseMcpStdioLaunchDraft(draft: McpStdioLaunchDraft): { launch: McpStdioLaunch; error?: never } | { error: string; launch?: never } {
  if (!textBytes(draft.executable, 4096) || !draft.executable.startsWith('/')) return { error: 'Enter an absolute executable path, starting with /. Commands and ~ shortcuts are not expanded.' }
  if (!textBytes(draft.cwd, 4096) || !draft.cwd.startsWith('/')) return { error: 'Enter an absolute working directory, starting with /.' }
  if (draft.argumentsJson.length > 131072 || draft.environmentJson.length > 131072) return { error: 'Arguments and environment are too large. Reduce them before reviewing.' }
  let args: unknown, env: unknown
  try { args = JSON.parse(draft.argumentsJson) } catch { return { error: 'Arguments must be a JSON array of strings, such as ["--read-only"].' } }
  if (!Array.isArray(args) || args.length > 64 || !args.every(value => textBytes(value, 8192))) return { error: 'Use at most 64 string arguments, each no more than 8 KiB, without NUL characters.' }
  try { env = JSON.parse(draft.environmentJson) } catch { return { error: 'Environment must be a JSON object with string values, such as {"MODE":"read-only"}.' } }
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 64 || Object.entries(env).some(([key, value]) =>
    !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !textBytes(value, 8192))) return { error: 'Use at most 64 valid environment names with string values, each no more than 8 KiB.' }
  const total = args.reduce((bytes, arg) => bytes + encoder.encode(arg).length + 1, 0) + Object.entries(env).reduce((bytes, [key, value]) => bytes + encoder.encode(key).length + encoder.encode(value as string).length + 2, 0)
  if (total > 65536) return { error: 'Arguments and environment together must fit within 64 KiB.' }
  return { launch: Object.freeze({ executable: draft.executable, cwd: draft.cwd, args: Object.freeze([...args]), env: Object.freeze({ ...env }) as Readonly<Record<string, string>> }) }
}
