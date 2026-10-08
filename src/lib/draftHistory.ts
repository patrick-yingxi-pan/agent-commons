export const MAX_DRAFT_HISTORY_STATES = 50
export const MAX_DRAFT_HISTORY_BYTES = 2 * 1024 * 1024

/** JSON-safe trees: null, booleans, finite numbers, strings, arrays, and plain records. */
export type DraftHistoryValue =
  | null
  | boolean
  | number
  | string
  | DraftHistoryValue[]
  | { [key: string]: DraftHistoryValue }

export interface DraftHistory<T> {
  record(before: T, after: T, group?: symbol): void
  undo(current: T): T | undefined
  redo(current: T): T | undefined
  clear(): void
  closeGroup(): void
  canUndo(): boolean
  canRedo(): boolean
}

type Snapshot = { json: string; bytes: number }

function stableJson(value: unknown, active = new WeakSet<object>()): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? (Object.is(value, -0) ? '-0' : JSON.stringify(value)) : undefined
  }
  if (typeof value !== 'object') return undefined
  if (active.has(value)) return undefined

  active.add(value)
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value)
      if (ownKeys.some((key) => key !== 'length' && typeof key !== 'string')) return undefined
      const entries: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return undefined
        const item = stableJson(value[index], active)
        if (item === undefined) return undefined
        entries.push(item)
      }
      if (ownKeys.length !== value.length + 1) return undefined
      return `[${entries.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key !== 'string')) return undefined

    const keys = (ownKeys as string[]).sort()
    const entries: string[] = []
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return undefined
      const item = stableJson(descriptor.value, active)
      if (item === undefined) return undefined
      entries.push(`${JSON.stringify(key)}:${item}`)
    }
    return `{${entries.join(',')}}`
  } catch {
    return undefined
  } finally {
    active.delete(value)
  }
}

function serialize(value: unknown): Snapshot | undefined {
  const json = stableJson(value)
  if (json === undefined) return undefined
  return { json, bytes: new TextEncoder().encode(json).byteLength }
}

function deserialize<T>(snapshot: Snapshot): T {
  return JSON.parse(snapshot.json) as T
}

/** A bounded, detached history for JSON-safe data in one in-memory draft. */
export function createDraftHistory<T>(): DraftHistory<T> {
  const undoStates: Snapshot[] = []
  const redoStates: Snapshot[] = []
  let retainedBytes = 0
  let groupInProgress: symbol | undefined

  const pushUndo = (snapshot: Snapshot) => {
    undoStates.push(snapshot)
    retainedBytes += snapshot.bytes
  }

  const pushRedo = (snapshot: Snapshot) => {
    redoStates.push(snapshot)
    retainedBytes += snapshot.bytes
  }

  const popUndo = () => {
    const snapshot = undoStates.pop()
    if (snapshot) retainedBytes -= snapshot.bytes
    return snapshot
  }

  const popRedo = () => {
    const snapshot = redoStates.pop()
    if (snapshot) retainedBytes -= snapshot.bytes
    return snapshot
  }

  const pruneOldestUndo = () => {
    const snapshot = undoStates.shift()
    if (snapshot) retainedBytes -= snapshot.bytes
  }

  const pruneOldestRedo = () => {
    const snapshot = redoStates.shift()
    if (snapshot) retainedBytes -= snapshot.bytes
  }

  const discardRedo = () => {
    retainedBytes -= redoStates.reduce((total, state) => total + state.bytes, 0)
    redoStates.length = 0
  }

  const discardUndo = () => {
    retainedBytes -= undoStates.reduce((total, state) => total + state.bytes, 0)
    undoStates.length = 0
  }

  const enforceBounds = (preferredDirection: 'undo' | 'redo') => {
    while (
      undoStates.length + redoStates.length > MAX_DRAFT_HISTORY_STATES ||
      retainedBytes > MAX_DRAFT_HISTORY_BYTES
    ) {
      if (preferredDirection === 'undo' && undoStates.length > 0) pruneOldestUndo()
      else if (preferredDirection === 'redo' && redoStates.length > 0) pruneOldestRedo()
      else if (undoStates.length > 0) pruneOldestUndo()
      else if (redoStates.length > 0) pruneOldestRedo()
      else break
    }
  }

  const clear = () => {
    undoStates.length = 0
    redoStates.length = 0
    retainedBytes = 0
    groupInProgress = undefined
  }

  return {
    record(before: T, after: T, group?: symbol): void {
      const beforeSnapshot = serialize(before)
      const afterSnapshot = serialize(after)
      if (beforeSnapshot && afterSnapshot && beforeSnapshot.json === afterSnapshot.json) return

      if (!beforeSnapshot || beforeSnapshot.bytes > MAX_DRAFT_HISTORY_BYTES) {
        clear()
        return
      }

      discardRedo()
      if (group === undefined || groupInProgress !== group || undoStates.length === 0) {
        pushUndo(beforeSnapshot)
      }
      groupInProgress = group
      enforceBounds('undo')
    },
    undo(current: T): T | undefined {
      groupInProgress = undefined
      const target = popUndo()
      if (!target) return undefined

      const currentSnapshot = serialize(current)
      if (!currentSnapshot || currentSnapshot.bytes > MAX_DRAFT_HISTORY_BYTES) {
        discardRedo()
      } else {
        pushRedo(currentSnapshot)
        enforceBounds('undo')
      }
      return deserialize<T>(target)
    },
    redo(current: T): T | undefined {
      groupInProgress = undefined
      const target = popRedo()
      if (!target) return undefined

      const currentSnapshot = serialize(current)
      if (!currentSnapshot || currentSnapshot.bytes > MAX_DRAFT_HISTORY_BYTES) {
        discardUndo()
      } else {
        pushUndo(currentSnapshot)
        enforceBounds('redo')
      }
      return deserialize<T>(target)
    },
    clear,
    closeGroup(): void {
      groupInProgress = undefined
    },
    canUndo: () => undoStates.length > 0,
    canRedo: () => redoStates.length > 0,
  }
}
