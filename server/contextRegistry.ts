import type {
  ContextStatus,
  ContextTypeId,
  RecentsSnapshot,
  SavedContext,
  SavedContextsSnapshot,
} from '../contract/index.ts'
import { ConflictError } from './conflict.ts'

type OwnedSavedContext = SavedContext & { tenantId?: string }

const boundedText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= max ? normalized : undefined
}

/** Strict HTTP input funnel. Unknown fields (including `tenantId`) are ignored;
 * every public field is normalized before the server-owned stamp is applied. */
export function savedContextFrom(value: unknown): SavedContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const id = boundedText(row.id, 256)
  const label = boundedText(row.label, 256)
  const detail = boundedText(row.detail, 2_048)
  if (!id || !label || !detail) return undefined
  if (row.kind !== 'connector' && row.kind !== 'mcp' && row.kind !== 'repo') return undefined
  if (row.status !== 'connected' && row.status !== 'needs-auth') return undefined
  if (row.lastUsedAt !== null && (typeof row.lastUsedAt !== 'number' || !Number.isFinite(row.lastUsedAt) || row.lastUsedAt < 0)) return undefined
  if (!Number.isInteger(row.sessions) || (row.sessions as number) < 0 || (row.sessions as number) > 1_000_000) return undefined
  if (row.connectorKind !== undefined && row.connectorKind !== 'github' && row.connectorKind !== 'connector' && row.connectorKind !== 'mcp') return undefined
  if (row.origin !== undefined && row.origin !== 'local' && row.origin !== 'github') return undefined
  if (row.dependsOnGitHub !== undefined && typeof row.dependsOnGitHub !== 'boolean') return undefined
  return {
    id,
    label,
    kind: row.kind,
    status: row.status,
    detail,
    lastUsedAt: row.lastUsedAt as number | null,
    sessions: row.sessions as number,
    ...(row.connectorKind !== undefined ? { connectorKind: row.connectorKind } : {}),
    ...(row.origin !== undefined ? { origin: row.origin } : {}),
    ...(row.dependsOnGitHub !== undefined ? { dependsOnGitHub: row.dependsOnGitHub } : {}),
  }
}

const emptyRecents = (): RecentsSnapshot => ({
  files: [],
  photos: [],
  folder: [],
  repo: [],
  connector: [],
  mcp: [],
})

const cloneRecents = (value: RecentsSnapshot): RecentsSnapshot => ({
  files: [...value.files],
  photos: [...value.photos],
  folder: [...value.folder],
  repo: [...value.repo],
  connector: [...value.connector],
  mcp: [...value.mcp],
})

const publicContext = ({ tenantId: _tenantId, ...context }: OwnedSavedContext): SavedContext => ({
  ...context,
  connectionRevision: context.connectionRevision ?? 0,
})

/**
 * Viewer-owned Contexts setup state. Ownership never comes from the request
 * body: runtime rows are stamped by the authenticated tenant, while unstamped
 * seed/legacy rows belong to the backend's default tenant. Recents use the same
 * partition so a quick-list id cannot become a cross-tenant existence hint.
 */
export function createContextRegistry({
  seedContexts,
  seedRecents,
  defaultTenantId,
}: {
  seedContexts: SavedContext[]
  seedRecents: RecentsSnapshot
  defaultTenantId: () => string
}) {
  const contexts: OwnedSavedContext[] = structuredClone(seedContexts)
  const recentsByTenant = new Map<string, RecentsSnapshot>([
    [defaultTenantId(), cloneRecents(seedRecents)],
  ])

  const ownerOf = (context: OwnedSavedContext) => context.tenantId ?? defaultTenantId()
  const ownedContext = (id: string, tenantId: string) =>
    contexts.find((context) => context.id === id && ownerOf(context) === tenantId)
  const recentsFor = (tenantId: string) => {
    const current = recentsByTenant.get(tenantId)
    if (current) return current
    const empty = emptyRecents()
    recentsByTenant.set(tenantId, empty)
    return empty
  }
  const snapshotFor = (tenantId: string): SavedContextsSnapshot => {
    const visible = contexts.filter((context) => ownerOf(context) === tenantId).map(publicContext)
    return {
      contexts: visible,
      connectedConnectorIds: visible
        .filter((context) => context.kind === 'connector' && context.status === 'connected')
        .map((context) => context.id),
      connectedMcpIds: visible
        .filter((context) => context.kind === 'mcp' && context.status === 'connected')
        .map((context) => context.id),
    }
  }

  return {
    snapshot: snapshotFor,

    add(context: SavedContext, tenantId: string): { context: SavedContext; created: boolean } {
      const existing = ownedContext(context.id, tenantId)
      if (existing) return { context: publicContext(existing), created: false }
      // A caller can smuggle arbitrary JSON beyond the compile-time contract.
      // Copy only the public SavedContext fields, then stamp server-owned identity.
      const { id, label, kind, status, detail, lastUsedAt, sessions, connectorKind, origin, dependsOnGitHub } = context
      const owned: OwnedSavedContext = {
        id,
        label,
        kind,
        status,
        detail,
        lastUsedAt,
        sessions,
        connectionRevision: 0,
        ...(connectorKind !== undefined ? { connectorKind } : {}),
        ...(origin !== undefined ? { origin } : {}),
        ...(dependsOnGitHub !== undefined ? { dependsOnGitHub } : {}),
        tenantId,
      }
      contexts.unshift(owned)
      return { context: publicContext(owned), created: true }
    },

    setStatus(
      id: string,
      status: ContextStatus,
      tenantId: string,
      expectedRevision?: number,
    ): { snapshot: SavedContextsSnapshot; changed: boolean } | undefined {
      const context = ownedContext(id, tenantId)
      if (!context) return undefined
      const currentRevision = context.connectionRevision ?? 0
      // Convergent retry: if an acknowledgement was lost and the idempotency
      // cache did not survive a restart, the already-realized desired state is
      // success rather than a false conflict or a second revision.
      if (context.status === status) return { snapshot: snapshotFor(tenantId), changed: false }
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new ConflictError(
          `This context connection changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
        )
      }
      context.status = status
      context.connectionRevision = currentRevision + 1
      return { snapshot: snapshotFor(tenantId), changed: true }
    },

    remove(id: string, tenantId: string): boolean {
      const index = contexts.findIndex((context) => context.id === id && ownerOf(context) === tenantId)
      if (index < 0) return false
      contexts.splice(index, 1)
      return true
    },

    recents(tenantId: string): RecentsSnapshot {
      return cloneRecents(recentsFor(tenantId))
    },

    pushRecent(type: ContextTypeId, id: string, tenantId: string): RecentsSnapshot {
      const current = recentsFor(tenantId)
      const list = current[type]
      const next = { ...current, [type]: [id, ...list.filter((candidate) => candidate !== id)] }
      recentsByTenant.set(tenantId, next)
      return cloneRecents(next)
    },

    persistedContexts(): OwnedSavedContext[] {
      return structuredClone(contexts)
    },

    persistedRecents(): { defaultRecents: RecentsSnapshot; tenantRecents: [string, RecentsSnapshot][] } {
      const owner = defaultTenantId()
      return {
        defaultRecents: cloneRecents(recentsFor(owner)),
        tenantRecents: [...recentsByTenant.entries()]
          .filter(([tenantId]) => tenantId !== owner)
          .map(([tenantId, value]) => [tenantId, cloneRecents(value)]),
      }
    },

    rehydrate({
      savedContexts,
      defaultRecents,
      tenantRecents,
    }: {
      savedContexts?: OwnedSavedContext[]
      defaultRecents: RecentsSnapshot
      tenantRecents?: [string, RecentsSnapshot][]
    }): void {
      if (savedContexts) contexts.splice(0, contexts.length, ...structuredClone(savedContexts))
      recentsByTenant.clear()
      recentsByTenant.set(defaultTenantId(), cloneRecents(defaultRecents))
      for (const [tenantId, value] of tenantRecents ?? []) {
        if (tenantId !== defaultTenantId()) recentsByTenant.set(tenantId, cloneRecents(value))
      }
    },
  }
}
