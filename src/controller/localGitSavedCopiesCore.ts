/** Byte-free identity/lifetime owner for explicit saved-preview intents. */
export type LocalSavedCopySourceKind = 'git' | 'folder'

export function createLocalGitSavedCopiesCore() {
  type Entry = { id: string; account: string; sourceKind: LocalSavedCopySourceKind; connectionId: string; receipt: number; pending: boolean; promise: Promise<unknown> | null }
  const entries = new Map<string, Entry>()
  const listeners = new Map<string, Set<() => void>>()
  const keyOf = (scope: string, sourceKind: LocalSavedCopySourceKind, connectionId: string, receipt: number) => JSON.stringify([scope, sourceKind, connectionId, receipt])
  const accountOf = (scope: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(scope) } catch { throw new TypeError('Saved-copy scope must be a canonical [account generation, target] tuple.') }
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || typeof parsed[1] !== 'string' || !parsed[1]) {
      throw new TypeError('Saved-copy scope must be a canonical [account generation, target] tuple.')
    }
    return JSON.stringify(parsed[0])
  }
  const idsFor = (scope: string, sourceKind?: LocalSavedCopySourceKind) => {
    const prefix = sourceKind === undefined ? `[${JSON.stringify(scope)},` : `[${JSON.stringify(scope)},${JSON.stringify(sourceKind)},`
    return [...entries].filter(([key]) => key.startsWith(prefix)).map(([, entry]) => entry.id)
  }
  const publish = (key: string) => { for (const listener of listeners.get(key) ?? []) listener() }
  const getOrCreate = (scope: string, sourceKind: LocalSavedCopySourceKind, connectionId: string, receipt: number, makeId: () => string) => {
    const key = keyOf(scope, sourceKind, connectionId, receipt)
    let entry = entries.get(key)
    if (!entry) { entry = { id: makeId(), account: accountOf(scope), sourceKind, connectionId, receipt, pending: false, promise: null }; entries.set(key, entry) }
    return { key, entry }
  }
  return {
    id(scope: string, connectionId: string, receipt: number, sourceKind: LocalSavedCopySourceKind = 'git'): string | undefined {
      return entries.get(keyOf(scope, sourceKind, connectionId, receipt))?.id
    },
    isPending(scope: string, connectionId: string, receipt: number, sourceKind: LocalSavedCopySourceKind = 'git') {
      return entries.get(keyOf(scope, sourceKind, connectionId, receipt))?.pending ?? false
    },
    submit(scope: string, connectionId: string, receipt: number, makeId: () => string,
      work: (id: string) => unknown | Promise<unknown>, sourceKind: LocalSavedCopySourceKind = 'git') {
      const { key, entry } = getOrCreate(scope, sourceKind, connectionId, receipt, makeId)
      if (entry.promise) return { id: entry.id, promise: entry.promise, coalesced: true }
      entry.pending = true
      publish(key)
      const promise = Promise.resolve().then(() => work(entry.id)).finally(() => {
        entry.pending = false
        entry.promise = null
        publish(key)
      })
      entry.promise = promise
      return { id: entry.id, promise, coalesced: false }
    },
    subscribe(scope: string, connectionId: string, receipt: number, listener: () => void, sourceKind: LocalSavedCopySourceKind = 'git') {
      const key = keyOf(scope, sourceKind, connectionId, receipt)
      const set = listeners.get(key) ?? new Set<() => void>()
      set.add(listener); listeners.set(key, set)
      return () => { set.delete(listener); if (!set.size) listeners.delete(key) }
    },
    ids(scope: string, sourceKind?: LocalSavedCopySourceKind) {
      return idsFor(scope, sourceKind)
    },
    adoptAttachments(scope: string, attachmentIds: readonly string[]) {
      const present = new Set(attachmentIds)
      const account = accountOf(scope)
      for (const entry of [...entries.values()]) {
        if (entry.account !== account || !present.has(entry.id)) continue
        const key = keyOf(scope, entry.sourceKind, entry.connectionId, entry.receipt)
        const current = entries.get(key)
        if (!current || !present.has(current.id)) {
          entries.set(key, { ...entry, pending: false, promise: null })
        }
      }
      return [...new Set(idsFor(scope))]
    },
    /** Reconcile draft promotion, then project only IDs that are currently
     * represented by authoritative attachments. */
    acknowledgedIds(scope: string, attachmentIds: readonly string[], sourceKind: LocalSavedCopySourceKind = 'git') {
      const present = new Set(attachmentIds)
      this.adoptAttachments(scope, attachmentIds)
      return [...new Set(idsFor(scope, sourceKind))].filter(id => present.has(id))
    },
    /** Entries retain only opaque receipt/attachment identity. Clearing drops
     * metadata but never cancels work already submitted to the context funnel. */
    clear() { entries.clear(); for (const key of listeners.keys()) publish(key) },
  }
}
