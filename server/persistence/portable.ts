/** Portable persistence export / restore.
 *
 * Backends are an implementation detail of one durable state contract. A backup
 * therefore carries the canonical `PersistedState` JSON, never a copy of the
 * backend's private bytes: a JSON-backed desktop can restore into SQLite (and the
 * reverse), and a future schema implementation does not strand older exports.
 *
 * Restore validates and forward-migrates the export *before* it writes anything,
 * then reads the selected backend back and compares its canonical form. Backends
 * must throw on I/O failure; read-back additionally catches a logically incomplete
 * or non-conforming backend so recovery cannot claim success without proof. */
import {
  readFileSync,
} from 'node:fs'
import {
  hasCorePersistedShape,
  type PersistedState,
  type PersistenceBackend,
} from './format.ts'
import { migrateState } from './migrate.ts'
import { writeTextFileAtomically } from './atomicFile.ts'
import { ALL_ARTIFACTS } from '../data/cowork.ts'
import { resolveIdentity } from '../identity.ts'
import { prepareCommissionRestoreState } from './commissionRestore.ts'

function artifactHistoryReferencesAreCanonical(state: PersistedState): boolean {
  if (!state.artifactHistory?.length && !state.artifactHistoryRestoreReceipts?.length) return true

  const artifacts = new Map<string, { kind: string; tenantId?: string }>()
  const world = state.initialWorld ?? 'demo'
  if (world === 'demo') {
    for (const artifact of ALL_ARTIFACTS) artifacts.set(artifact.id, artifact)
  }
  const extras = state.graph?.extraArtifacts
  if (!Array.isArray(extras)) return false
  for (const value of extras) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const artifact = value as { id?: unknown; kind?: unknown; tenantId?: unknown }
    if (typeof artifact.id !== 'string' || !artifact.id || typeof artifact.kind !== 'string' ||
      (artifact.tenantId !== undefined && typeof artifact.tenantId !== 'string') || artifacts.has(artifact.id)) return false
    artifacts.set(artifact.id, {
      kind: artifact.kind,
      ...(typeof artifact.tenantId === 'string' ? { tenantId: artifact.tenantId } : {}),
    })
  }

  const compatibleBody = (kind: string, type: string): boolean =>
    kind === 'doc' || kind === 'email' ? type === 'doc'
      : kind === 'sheet' ? type === 'sheet' || type === 'workbook'
        : kind === 'slide' && type === 'slides'

  for (const [id, versions] of state.artifactHistory ?? []) {
    const artifact = artifacts.get(id)
    if (!artifact || versions.some((version) => !compatibleBody(artifact.kind, version.body.type))) return false
  }

  const backend = process.env.BACKEND === 'remote' ? 'remote' : 'mock'
  for (const receipt of state.artifactHistoryRestoreReceipts ?? []) {
    const artifact = artifacts.get(receipt[1]?.artifactId)
    const ownerTenantId = artifact?.tenantId ?? resolveIdentity(backend).tenant.id
    if (!artifact || !state.artifactHistory?.some(([id]) => id === receipt[1].artifactId) ||
      receipt[1].tenantId !== ownerTenantId) return false
  }
  return true
}

function canonical(state: PersistedState): PersistedState {
  return JSON.parse(JSON.stringify(state)) as PersistedState
}

function sameState(left: PersistedState, right: PersistedState): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/** Parse an export without mutating the live backend. Older supported versions
 * are migrated exactly as they are during server boot. */
export function readPortableSnapshot(file: string): PersistedState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`snapshot at ${file} is not readable JSON: ${(err as Error).message}`)
  }
  let state: PersistedState | null
  try {
    state = migrateState(parsed as PersistedState)
  } catch {
    state = null
  }
  if (!hasCorePersistedShape(state)) {
    throw new Error(`snapshot at ${file} has an unsupported or invalid store version`)
  }
  if (!artifactHistoryReferencesAreCanonical(state)) {
    throw new Error(`snapshot at ${file} has orphaned or incompatible Artifact history`)
  }
  return canonical(state)
}

/** Atomically materialize canonical portable JSON (temp file + rename). */
export function writePortableSnapshot(file: string, state: PersistedState): void {
  const checked = migrateState(canonical(state))
  if (!hasCorePersistedShape(checked)) throw new Error('refusing to export an unsupported or invalid store version')
  if (!artifactHistoryReferencesAreCanonical(checked)) throw new Error('refusing to export orphaned or incompatible Artifact history')

  try {
    writeTextFileAtomically(file, JSON.stringify(canonical(checked)), `.tmp-${process.pid}`)
  } catch (err) {
    throw new Error(`failed to write portable snapshot at ${file}: ${(err as Error).message}`)
  }
}

/** Export the selected backend through its public state port. */
export function exportBackendSnapshot(
  backend: PersistenceBackend,
  file: string,
): PersistedState {
  const state = backend.load()
  if (!state) {
    throw new Error(`no live persisted state in the ${backend.name} backend`)
  }
  writePortableSnapshot(file, state)
  return canonical(state)
}

/** Restore a portable export into any backend and prove the write landed. */
export function restoreBackendSnapshot(
  backend: PersistenceBackend,
  file: string,
): PersistedState {
  const state = readPortableSnapshot(file)
  return restoreBackendState(backend, state)
}

/** Restore an already-validated state. Kept separate so callers can validate an
 * export before opening (and, for SQLite, possibly creating) the live store. */
export function restoreBackendState(
  backend: PersistenceBackend,
  state: PersistedState,
): PersistedState {
  let checked = migrateState(canonical(state))
  if (!hasCorePersistedShape(checked)) {
    throw new Error('refusing to restore an unsupported or invalid store version')
  }
  if (!artifactHistoryReferencesAreCanonical(checked)) {
    throw new Error('refusing to restore orphaned or incompatible Artifact history')
  }
  checked = prepareCommissionRestoreState(checked)
  checked = migrateState(checked)
  if (!hasCorePersistedShape(checked) || !artifactHistoryReferencesAreCanonical(checked)) {
    throw new Error('refusing to restore an invalid safety-transformed snapshot')
  }
  backend.save(checked)
  const restored = backend.load()
  if (!restored || !sameState(restored, checked)) {
    throw new Error(`the ${backend.name} backend did not retain the restored snapshot`)
  }
  return canonical(restored)
}
