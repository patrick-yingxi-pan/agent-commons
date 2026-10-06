import { isGitSnapshotPath, MAX_GIT_SNAPSHOT_ENTRIES } from '../contract/localGitSnapshot.mjs'

const REGULAR_MODES = new Set(['100644', '100755'])
const MODE_CATEGORIES = new Map([
  ['100644', 'regular'], ['100755', 'regular'],
  ['120000', 'symlink'], ['160000', 'gitlink'], ['040000', 'tree'],
])
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const fail = () => { throw new Error('The Git review plan is invalid or exceeds its limits.') }

function validObject(value, { allowSparse = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { mode, oid } = value
  return typeof mode === 'string' && MODE_CATEGORIES.has(mode) && (allowSparse || mode !== '040000') &&
    typeof oid === 'string' && OID.test(oid) && !/^0+$/.test(oid)
}

function sparseFor(path, sparsePaths) {
  return sparsePaths.some((directory) => path === directory || path.startsWith(`${directory}/`))
}

/** Build a bounded, deterministic comparison plan from HEAD and staged index entries. */
export function planGitReview(headEntries, indexEntries) {
  if (!Array.isArray(headEntries) || !Array.isArray(indexEntries) ||
    headEntries.length > MAX_GIT_SNAPSHOT_ENTRIES || indexEntries.length > MAX_GIT_SNAPSHOT_ENTRIES * 3) fail()

  const headByPath = new Map()
  for (const entry of headEntries) {
    if (!entry || typeof entry.name !== 'string' || !isGitSnapshotPath(entry.name) || !validObject(entry) || headByPath.has(entry.name)) fail()
    headByPath.set(entry.name, { mode: entry.mode, oid: entry.oid })
  }

  const indexByPath = new Map()
  const sparsePaths = []
  for (const entry of indexEntries) {
    if (!entry || typeof entry.name !== 'string' || !isGitSnapshotPath(entry.name) ||
      !validObject(entry, { allowSparse: true }) || !Number.isInteger(entry.stage) || entry.stage < 0 || entry.stage > 3 ||
      (entry.skipWorktree !== undefined && typeof entry.skipWorktree !== 'boolean') ||
      ((entry.mode === '040000' || entry.skipWorktree) && entry.stage !== 0)) fail()
    let stages = indexByPath.get(entry.name)
    if (!stages) { stages = new Map(); indexByPath.set(entry.name, stages) }
    if (stages.has(entry.stage) || (entry.stage === 0 && stages.size > 0) || (entry.stage !== 0 && stages.has(0))) fail()
    stages.set(entry.stage, { mode: entry.mode, oid: entry.oid })
    if (entry.mode === '040000' || entry.skipWorktree) sparsePaths.push(entry.name)
  }

  const paths = new Set([...headByPath.keys(), ...indexByPath.keys()])
  if (paths.size > MAX_GIT_SNAPSHOT_ENTRIES) fail()
  return [...paths].sort().map((path) => {
    const stages = indexByPath.get(path)
    const index = stages?.get(0) ?? null
    return {
      path,
      head: headByPath.get(path) ?? null,
      index,
      conflicted: Boolean(stages && [...stages.keys()].some((stage) => stage !== 0)),
      sparse: sparseFor(path, sparsePaths),
    }
  })
}

/** Classify a single path's HEAD/index transition without conflating mode and type. */
export function compareGitEntries(before, after) {
  if (before === null && after === null) return 'unchanged'
  if (before === null) {
    if (!validObject(after, { allowSparse: true })) fail()
    return 'added'
  }
  if (after === null) {
    if (!validObject(before, { allowSparse: true })) fail()
    return 'deleted'
  }
  if (!validObject(before, { allowSparse: true }) || !validObject(after, { allowSparse: true })) fail()
  const beforeCategory = MODE_CATEGORIES.get(before.mode)
  const afterCategory = MODE_CATEGORIES.get(after.mode)
  if (beforeCategory !== afterCategory) return 'type-changed'
  if (before.mode === after.mode && before.oid === after.oid) return 'unchanged'
  if (REGULAR_MODES.has(before.mode) && REGULAR_MODES.has(after.mode) && before.oid === after.oid) return 'mode-changed'
  return 'modified'
}
