import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactSourceSessionId } from './artifactSource.ts'
import { runSessionId } from '../../contract/ids.ts'
import type { ArtifactItem, ScheduledRun, ScheduledTask, Session } from '../../contract/index.ts'

const session = (id: string, title: string): Pick<Session, 'id' | 'title'> => ({ id, title })
const run = (id: string): ScheduledRun => ({
  id,
  status: 'ok',
  duration: '1s',
  reachedStep: 1,
  summary: 'done',
  at: 1,
})
const schedule = (id: string, own: boolean | undefined, runs: ScheduledRun[]): Pick<ScheduledTask, 'id' | 'own' | 'runs'> => ({ id, own, runs })
const artifact = (source: string, sourceSessionId?: string): Pick<ArtifactItem, 'source' | 'sourceSessionId'> => ({
  source,
  ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
})

test('an explicit session source id wins without consulting the mutable title', () => {
  assert.equal(
    artifactSourceSessionId(artifact('Renamed conversation', 's1'), [session('s1', 'Current title')], []),
    's1',
  )
})

test('an explicit owned routine run source id resolves through the stable run session id', () => {
  const task = schedule('routine-1', true, [run('run-1')])
  assert.equal(
    artifactSourceSessionId(artifact('Scheduled run', runSessionId('routine-1', 'run-1')), [], [task]),
    runSessionId('routine-1', 'run-1'),
  )
})

test('private or granted-only routines cannot authorize an explicit source link', () => {
  const id = runSessionId('routine-1', 'run-1')
  assert.equal(artifactSourceSessionId(artifact('Scheduled run', id), [], [schedule('routine-1', false, [run('run-1')])]), undefined)
  assert.equal(artifactSourceSessionId(artifact('Scheduled run', id), [], [schedule('routine-1', undefined, [run('run-1')])]), undefined)
})

test('an explicit missing source id never falls back to a matching session title', () => {
  assert.equal(
    artifactSourceSessionId(artifact('Conversation title', 'missing-session'), [session('s1', 'Conversation title')], []),
    undefined,
  )
})

test('legacy artifacts resolve one unambiguous session title, but ambiguity fails closed', () => {
  assert.equal(artifactSourceSessionId(artifact('Conversation title'), [session('s1', 'Conversation title')], []), 's1')
  assert.equal(
    artifactSourceSessionId(artifact('Conversation title'), [session('s1', 'Conversation title'), session('s2', 'Conversation title')], []),
    undefined,
  )
  assert.equal(artifactSourceSessionId(artifact('Missing title'), [session('s1', 'Conversation title')], []), undefined)
})
