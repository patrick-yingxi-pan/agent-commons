import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { store } from '../store/index.ts'
import type { ProjectChangedEvent, ServerEvent } from '../../contract/index.ts'
import { closePersistence, loadState, PersistenceWriteError } from './persist.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'agent-commons-project-events-'))
const FILE = join(ROOT, 'store.json')
const BLOCKED = join(ROOT, 'blocked-store-path')
const previousDataFile = process.env.DATA_FILE
const previousBackend = process.env.PERSIST_BACKEND

before(() => {
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = FILE
  store.initPersistence()
})

after(() => {
  closePersistence()
  if (previousDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = previousDataFile
  if (previousBackend === undefined) delete process.env.PERSIST_BACKEND
  else process.env.PERSIST_BACKEND = previousBackend
  rmSync(ROOT, { recursive: true, force: true })
})

function projectEvents(events: ServerEvent[]): ProjectChangedEvent[] {
  return events.filter((event): event is ProjectChangedEvent => event.type === 'project.changed')
}

test('project changed publishes only after its durable description is committed', () => {
  const projectId = 'proj-persistence-project-events'
  store.applyRelationOp({
    kind: 'create-project',
    projectId,
    projectName: 'Persistence project event',
    projectDescription: 'Private before save',
  }, 'tenant-personal')

  const snapshots: ReturnType<typeof loadState>[] = []
  const events: ServerEvent[] = []
  const unsubscribe = store.subscribe((event) => {
    events.push(event)
    if (event.type === 'project.changed') snapshots.push(loadState())
  })
  try {
    store.applyRelationOp({
      kind: 'set-project-description',
      projectId,
      projectName: 'Persistence project event',
      description: 'Committed current public prose',
    }, 'tenant-personal')
  } finally {
    unsubscribe()
  }

  const changed = projectEvents(events)
  assert.equal(changed.length, 1)
  assert.equal(changed[0]?.projectId, projectId)
  assert.equal(snapshots.length, 1, 'the event subscriber observes a durable snapshot')
  assert.equal(snapshots[0]?.graph.projectDescriptions?.[projectId], 'Committed current public prose')
  assert.equal(loadState()?.graph.projectDescriptions?.[projectId], 'Committed current public prose')
})

test('a failed JSON commit publishes neither relation nor project invalidation and preserves the file', () => {
  const projectId = 'proj-persistence-project-events-failure'
  store.applyRelationOp({
    kind: 'create-project',
    projectId,
    projectName: 'Persistence failure project',
    projectDescription: 'Private before failed share',
  }, 'tenant-personal')
  const before = readFileSync(FILE, 'utf8')
  assert.equal(loadState()?.graph.extraProjects.find((project) => project.id === projectId)?.shared, undefined)

  mkdirSync(BLOCKED, { recursive: true })
  process.env.DATA_FILE = BLOCKED
  const events: ServerEvent[] = []
  const unsubscribe = store.subscribe((event) => events.push(event))
  try {
    assert.throws(
      () => store.applyRelationOp({
        kind: 'share-project',
        projectId,
        projectName: 'Persistence failure project',
        shared: true,
      }, 'tenant-personal'),
      (error: unknown) => error instanceof PersistenceWriteError,
    )
  } finally {
    unsubscribe()
  }

  assert.equal(events.some((event) => event.type === 'relation.applied'), false)
  assert.equal(events.some((event) => event.type === 'project.changed'), false)
  assert.equal(store.persistenceHealthy(), false, 'the failed process cannot serve its advanced in-memory state')
  process.env.DATA_FILE = FILE
  assert.equal(readFileSync(FILE, 'utf8'), before, 'the failed atomic write leaves the prior private snapshot intact')
  assert.equal(loadState()?.graph.extraProjects.find((project) => project.id === projectId)?.shared, undefined)
})
