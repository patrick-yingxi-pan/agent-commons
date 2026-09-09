import { createRequire } from 'node:module'
import { snapshotMcpJson, McpJsonError, type McpJsonValue } from './mcpJson.ts'

export type McpSchemaFailure =
  | 'invalid_schema'
  | 'unsupported_dialect'
  | 'invalid_value'
  | 'limit'
  | 'cancelled'
  | 'unavailable'

export type McpSchemaResult = { ok: true } | { ok: false; code: McpSchemaFailure }

const SUPPORTED_DIALECT = 'https://json-schema.org/draft/2020-12/schema'
const SCHEMA_LIMITS = { maxBytes: 64 * 1024, maxDepth: 32, maxNodes: 4096 } as const
const VALUE_LIMITS = { maxBytes: 1024 * 1024, maxDepth: 32, maxNodes: 16_384 } as const
const DEFAULT_TIMEOUT_MS = 2_000
const MAX_TIMEOUT_MS = 30_000
const MAX_ACTIVE_WORKERS = 4

interface WorkerHandle {
  stdout?: { resume(): void }
  stderr?: { resume(): void }
  once(event: 'message', listener: (message: unknown) => void): WorkerHandle
  once(event: 'error', listener: (error: unknown) => void): WorkerHandle
  once(event: 'exit', listener: (code: number) => void): WorkerHandle
  terminate(): Promise<number>
}
interface WorkerConstructor {
  new(filename: URL, options: {
    argv: string[]
    execArgv: string[]
    env: Record<string, string>
    stdin: boolean
    stdout: boolean
    stderr: boolean
    workerData: unknown
    resourceLimits: {
      maxOldGenerationSizeMb: number
      maxYoungGenerationSizeMb: number
      codeRangeSizeMb: number
      stackSizeMb: number
    }
  }): WorkerHandle
}
const { Worker } = createRequire(import.meta.url)('node:worker_threads') as { Worker: WorkerConstructor }
function object(value: McpJsonValue): value is { [key: string]: McpJsonValue } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function failure(code: McpSchemaFailure): McpSchemaResult {
  return { ok: false, code }
}

function snapshotFailure(error: unknown, invalidCode: 'invalid_schema' | 'invalid_value'): McpSchemaResult {
  const reason = error instanceof McpJsonError ? error.code : undefined
  return failure(reason === 'limit' ? 'limit' : invalidCode)
}

function workerFailure(error: unknown): McpSchemaResult {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  return failure(code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'limit' : 'unavailable')
}

function workerMessage(value: unknown): McpSchemaResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (Object.keys(value).length === 1 && (value as { ok?: unknown }).ok === true) return { ok: true }
  const code = (value as { code?: unknown }).code
  if (Object.keys(value).length === 2 && (value as { ok?: unknown }).ok === false &&
    (code === 'invalid_schema' || code === 'unsupported_dialect' || code === 'invalid_value')) return { ok: false, code }
  return undefined
}

let activeWorkers = 0

/** Compile an untrusted MCP JSON Schema, and optionally validate one JSON value,
 * in a short-lived resource-limited worker. This proves schema/value shape only;
 * it grants no tool authority and performs no network dereferencing. */
export async function validateMcpSchema(
  schema: unknown,
  value?: { value: unknown },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<McpSchemaResult> {
  if (options.signal?.aborted) return failure('cancelled')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return failure('limit')

  let schemaSnapshot: McpJsonValue
  try { schemaSnapshot = snapshotMcpJson(schema, SCHEMA_LIMITS) } catch (error) {
    return snapshotFailure(error, 'invalid_schema')
  }
  if (object(schemaSnapshot) && Object.hasOwn(schemaSnapshot, '$schema')) {
    if (typeof schemaSnapshot.$schema !== 'string') return failure('invalid_schema')
    if (schemaSnapshot.$schema !== SUPPORTED_DIALECT) return failure('unsupported_dialect')
  }

  const hasValue = value !== undefined
  let valueSnapshot: McpJsonValue | undefined
  if (hasValue) {
    const descriptor = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.getOwnPropertyDescriptor(value, 'value')
      : undefined
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      return failure('invalid_value')
    }
    try { valueSnapshot = snapshotMcpJson(descriptor.value, VALUE_LIMITS) } catch (error) {
      return snapshotFailure(error, 'invalid_value')
    }
  }
  if (options.signal?.aborted) return failure('cancelled')
  if (activeWorkers >= MAX_ACTIVE_WORKERS) return failure('unavailable')
  activeWorkers += 1

  return await new Promise<McpSchemaResult>((resolve) => {
    let worker: WorkerHandle | undefined
    let finishing = false
    let exited = false
    let markExited!: () => void
    const exitedPromise = new Promise<void>((resolveExit) => { markExited = resolveExit })
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = (): void => finish(failure('cancelled'))
    const finish = (result: McpSchemaResult): void => {
      if (finishing) return
      finishing = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void (async () => {
        if (worker) {
          try { await worker.terminate() } catch {
            // A failed terminate acknowledgement cannot release concurrency
            // while a real worker may still be consuming resources.
            if (!exited) await exitedPromise
          }
        }
        activeWorkers -= 1
        resolve(result)
      })()
    }

    try {
      worker = new Worker(new URL('./mcpSchemaWorker.mjs', import.meta.url), {
        argv: [], execArgv: [], env: {}, stdin: false, stdout: true, stderr: true,
        workerData: { schema: schemaSnapshot, hasValue, ...(hasValue ? { value: valueSnapshot } : {}) },
        resourceLimits: {
          maxOldGenerationSizeMb: 32,
          maxYoungGenerationSizeMb: 8,
          codeRangeSizeMb: 8,
          stackSizeMb: 2,
        },
      })
      worker.stdout?.resume()
      worker.stderr?.resume()
      worker.once('message', (message: unknown) => finish(workerMessage(message) ?? failure('unavailable')))
      worker.once('error', (error) => finish(workerFailure(error)))
      worker.once('exit', () => {
        exited = true
        markExited()
        if (!finishing) finish(failure('unavailable'))
      })
      timer = setTimeout(() => finish(failure('limit')), timeoutMs)
      timer.unref?.()
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
    } catch (error) {
      finish(workerFailure(error))
    }
  })
}
