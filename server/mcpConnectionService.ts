/** Connection lifecycle, not tool execution. Every retry resolves against the
 * saved connection before considering another outbound discovery transaction. */
import { createHash } from 'node:crypto'
import type {
  McpConnectionCreateRequest, McpConnectionInspectionRequest, McpConnectionMutationResult,
  McpHttpConnectionCreateRequest, McpStdioConnectionCreateRequest,
  McpConnectionRemovalResult, McpConnectionView,
} from '../contract/mcpConnections.ts'
import { createMcpConnectionInspector, McpInspectionError } from './mcpConnectionInspector.ts'
import { McpConnectionError, MCP_STDIO_REFERENCE_PATTERN, mcpConnectionCreationId, mcpStdioConnectionCreationId } from './mcpConnections.ts'
import { discoverMcpTools } from './mcpDiscovery.ts'
import { mcpRuntimeConfiguration, synchronizeMcpCredentials } from './mcpRuntime.ts'
import type { store as productStore } from './store/index.ts'

type ConnectionStore = Pick<typeof productStore, 'createMcpConnection' | 'privateMcpConnection' | 'mcpConnection' |
  'commitMcpInspection' | 'disconnectMcpConnection' | 'removeMcpConnection' | 'mcpCredentialBindings'> &
  Partial<Pick<typeof productStore, 'mcpStdioBindings'>>

export function mcpInspectionFingerprint(id: string, tenantId: string, request: McpConnectionInspectionRequest): string {
  return createHash('sha256').update(JSON.stringify(request.grantReference === undefined
    ? ['mcp-inspection-v1', tenantId, id, request.expectedRevision, request.credentialReference ?? null]
    : ['mcp-inspection-stdio-v1', tenantId, id, request.expectedRevision, request.grantReference])).digest('hex')
}

export function createMcpConnectionService({ store, configuration = mcpRuntimeConfiguration,
  synchronize = synchronizeMcpCredentials, discover = discoverMcpTools,
}: {
  store: ConnectionStore
  configuration?: typeof mcpRuntimeConfiguration
  synchronize?: typeof synchronizeMcpCredentials
  discover?: typeof discoverMcpTools
}) {
  const pending = new Map<string, { operationId: string; fingerprint: string; promise: Promise<McpConnectionMutationResult> }>()
  let inspectorConfiguration: ReturnType<typeof configuration> | undefined
  let inspector: ReturnType<typeof createMcpConnectionInspector> | undefined
  const current = (id: string, tenantId: string, actorUserId?: string): McpConnectionView => {
    const view = store.mcpConnection(id, tenantId, actorUserId)
    if (!view) throw new McpConnectionError('missing')
    return view
  }
  const stdioBindings = () => store.mcpStdioBindings?.() ?? []
  const acknowledged = async (id: string, tenantId: string, actorUserId?: string): Promise<McpConnectionMutationResult> => {
    const credentialCleanup = await synchronize(store.mcpCredentialBindings(), stdioBindings())
    return { connection: current(id, tenantId, actorUserId), credentialCleanup }
  }

  function create(request: McpStdioConnectionCreateRequest, tenantId: string, actorUserId?: string): Promise<{ connection: McpConnectionView; created: boolean }>
  function create(request: McpHttpConnectionCreateRequest, tenantId: string, actorUserId?: string): { connection: McpConnectionView; created: boolean }
  function create(request: McpConnectionCreateRequest, tenantId: string, actorUserId?: string): { connection: McpConnectionView; created: boolean } | Promise<{ connection: McpConnectionView; created: boolean }>
  function create(request: McpConnectionCreateRequest, tenantId: string, actorUserId?: string): { connection: McpConnectionView; created: boolean } | Promise<{ connection: McpConnectionView; created: boolean }> {
    const runtime = configuration()
    if (request.transport === 'stdio') {
      if (!actorUserId || !runtime.localProcessesAvailable || !runtime.openStdio) return Promise.reject(new McpInspectionError('credentials_unavailable'))
      const id = mcpStdioConnectionCreationId(tenantId, request.creationId, actorUserId)
      const result = store.createMcpConnection({ transport: 'stdio', id, label: request.label }, tenantId, false, actorUserId)
      return Promise.resolve(synchronize(store.mcpCredentialBindings(), stdioBindings())).then((cleanup) => {
        if (!runtime.localProcessesAvailable || !runtime.openStdio || cleanup === 'pending') throw new McpInspectionError('credentials_unavailable')
        return result
      })
    }
    const id = mcpConnectionCreationId(tenantId, request.creationId, request.authentication === 'device-oauth' ? actorUserId : undefined)
    const unavailable = (request.authentication === 'device-bearer' && !runtime.deviceBearerAvailable) ||
      (request.authentication === 'device-oauth' && !runtime.deviceOAuthAvailable)
    if (unavailable && !store.mcpConnection(id, tenantId, actorUserId)) {
      throw new McpInspectionError('credentials_unavailable')
    }
    return store.createMcpConnection({
      id,
      label: request.label, endpoint: request.endpoint, authentication: request.authentication,
    }, tenantId, runtime.allowLoopback, actorUserId)
  }

  return {
    create,

    inspect(id: string, tenantId: string, request: McpConnectionInspectionRequest, actorUserId?: string): Promise<McpConnectionMutationResult> {
      const row = store.privateMcpConnection(id, tenantId, actorUserId)
      if (!row) return Promise.reject(new McpConnectionError('missing'))
      const fingerprint = mcpInspectionFingerprint(id, tenantId, request)
      const key = JSON.stringify([tenantId, id])
      const existing = pending.get(key)
      if (existing) {
        if (existing.operationId !== request.operationId || existing.fingerprint !== fingerprint) {
          return Promise.reject(new McpConnectionError('conflict'))
        }
        return existing.promise
      }
      if (row.inspectionOperation?.id === request.operationId) {
        if (row.inspectionOperation.fingerprint !== fingerprint) return Promise.reject(new McpConnectionError('conflict'))
        // A later disconnect does not make an old acknowledgement a new grant.
        return acknowledged(id, tenantId, actorUserId)
      }
      if (row.revision !== request.expectedRevision) return Promise.reject(new McpConnectionError('conflict'))
      if (pending.size >= 16) return Promise.reject(new McpInspectionError('busy'))
      const runtime = configuration()
      if ((row.transport === 'stdio' && (!runtime.localProcessesAvailable || !runtime.openStdio ||
          typeof request.grantReference !== 'string' || !MCP_STDIO_REFERENCE_PATTERN.test(request.grantReference))) ||
          (row.transport !== 'stdio' && request.grantReference !== undefined) ||
          (row.transport !== 'stdio' && row.authentication === 'device-bearer' && !runtime.deviceBearerAvailable) ||
          (row.transport !== 'stdio' && row.authentication === 'device-oauth' && !runtime.deviceOAuthAvailable)) {
        return Promise.reject(new McpInspectionError('credentials_unavailable'))
      }
      if (!inspector || inspectorConfiguration !== runtime) {
        inspectorConfiguration = runtime
        inspector = createMcpConnectionInspector({ store, discover,
          allowLoopback: runtime.allowLoopback, resolveCredential: runtime.resolveCredential,
          resolveOAuthCredential: runtime.resolveOAuthCredential, openStdio: runtime.openStdio })
      }
      const runInspection = inspector
      // Publish the pending slot before starting even an immediately resolving
      // dependency. Only identical logical input can join this transaction.
      const entry = { operationId: request.operationId, fingerprint, promise: undefined! as Promise<McpConnectionMutationResult> }
      entry.promise = Promise.resolve().then(async () => {
        await runInspection(id, tenantId, request.expectedRevision, {
          credentialReference: request.credentialReference,
          grantReference: request.grantReference,
          operation: { id: request.operationId, fingerprint },
          actorUserId,
        })
        const result = await acknowledged(id, tenantId, actorUserId)
        if (row.transport === 'stdio' && result.credentialCleanup === 'pending') throw new McpInspectionError('credentials_unavailable')
        return result
      }).finally(() => {
        if (pending.get(key) === entry) pending.delete(key)
      })
      pending.set(key, entry)
      return entry.promise
    },

    async disconnect(id: string, tenantId: string, expectedRevision: number, actorUserId?: string): Promise<McpConnectionMutationResult> {
      const row = store.privateMcpConnection(id, tenantId, actorUserId)
      if (!row) throw new McpConnectionError('missing')
      // A lost acknowledgement of this convergent desired state can be retried
      // once the next revision proves the connection is already disconnected.
      if (row.connected || row.revision !== expectedRevision + 1) store.disconnectMcpConnection(id, tenantId, expectedRevision, actorUserId)
      return acknowledged(id, tenantId, actorUserId)
    },

    async remove(id: string, tenantId: string, expectedRevision: number, actorUserId?: string): Promise<McpConnectionRemovalResult> {
      const removed = store.removeMcpConnection(id, tenantId, expectedRevision, actorUserId)
      return { removed, credentialCleanup: await synchronize(store.mcpCredentialBindings(), stdioBindings()) }
    },

    async retryCleanup(id: string, tenantId: string, actorUserId?: string): Promise<McpConnectionMutationResult> {
      current(id, tenantId, actorUserId)
      return acknowledged(id, tenantId, actorUserId)
    },
  }
}
