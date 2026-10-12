/** Explicit formula sources, literal legacy strings, and history survive backend restarts. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { calculateSheet } from '../../contract/workbookCalculation.ts'
import { hasCorePersistedShape } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-formulas-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const routesModule = new URL('../testkit/http.ts', import.meta.url).href
after(() => rmSync(ROOT, { recursive: true, force: true }))

const authored = {
  type: 'sheet',
  columns: ['Count', 'Rate', 'Total', 'Legacy literal'],
  rows: [['2', '3', { formula: '=SUM(A1:B1)' }, '=SUM(A1:B1)']],
  note: 'Both formula source and literal text are authored data.',
}
const edited = structuredClone(authored)
edited.rows[0]![0] = '4'
const workbookAuthored = {
  type: 'workbook',
  sheets: [
    { id: 'overview', name: 'Overview', columns: ['Input'], rows: [['100']] },
    { id: 'detail', name: 'Detail', columns: ['Input', 'Calculated', 'Literal'], rows: [['6', { formula: '=A1*2' }, '=A1*2']] },
  ],
}
const workbookEdited = structuredClone(workbookAuthored)
workbookEdited.sheets[1]!.rows[0]![0] = '8'

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { call } = await import(${JSON.stringify(routesModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function resultOf(result: ReturnType<typeof boot>): any {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim())
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: formula cell source, literal cells, CAS history, restore and restart stay exact`, () => {
    const file = join(ROOT, `formula-${backend}`)
    const owner = `tenant-artifact-formula-${backend}`
    const first = resultOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const body = ${JSON.stringify(authored)};
      const created = await call('POST', '/artifacts', { name: 'formula-source.xlsx', kind: 'sheet', body }, { 'x-tenant-id': owner, 'idempotency-key': 'formula-source-create' });
      if (created.status !== 201) throw new Error('Formula Artifact create failed: ' + JSON.stringify(created));
      const id = created.json.artifact.id;
      const change = ${JSON.stringify(edited)};
      const edit = await call('PATCH', '/artifacts/' + id + '/content', { content: change, expectedRevision: 0 }, { 'x-tenant-id': owner, 'idempotency-key': 'formula-source-edit' });
      if (edit.status !== 200) throw new Error('Formula Artifact edit failed: ' + JSON.stringify(edit));
      const restore = await call('POST', '/artifacts/' + id + '/history/0/restore', { expectedRevision: 1 }, { 'x-tenant-id': owner, 'idempotency-key': 'formula-source-restore' });
      if (restore.status !== 200) throw new Error('Formula Artifact restore failed: ' + JSON.stringify(restore));
      const workbookBody = ${JSON.stringify(workbookAuthored)};
      const workbookCreated = await call('POST', '/artifacts', { name: 'workbook-formula-source.xlsx', kind: 'sheet', body: workbookBody }, { 'x-tenant-id': owner, 'idempotency-key': 'workbook-formula-create' });
      if (workbookCreated.status !== 201) throw new Error('Workbook Formula Artifact create failed: ' + JSON.stringify(workbookCreated));
      const workbookId = workbookCreated.json.artifact.id;
      const workbookChange = ${JSON.stringify(workbookEdited)};
      const workbookEdit = await call('PATCH', '/artifacts/' + workbookId + '/content', { content: workbookChange, expectedRevision: 0 }, { 'x-tenant-id': owner, 'idempotency-key': 'workbook-formula-edit' });
      if (workbookEdit.status !== 200) throw new Error('Workbook Formula Artifact edit failed: ' + JSON.stringify(workbookEdit));
      const workbookRestore = await call('POST', '/artifacts/' + workbookId + '/history/0/restore', { expectedRevision: 1 }, { 'x-tenant-id': owner, 'idempotency-key': 'workbook-formula-restore' });
      if (workbookRestore.status !== 200) throw new Error('Workbook Formula Artifact restore failed: ' + JSON.stringify(workbookRestore));
      const state = loadState();
      console.log(JSON.stringify({ id, body: store.artifactContent(owner)[id], historyPage: store.artifactHistoryPage(id, owner), history: state.artifactHistory.find(([artifactId]) => artifactId === id)?.[1], workbookId, workbookBody: store.artifactContent(owner)[workbookId], workbookHistoryPage: store.artifactHistoryPage(workbookId, owner), workbookHistory: state.artifactHistory.find(([artifactId]) => artifactId === workbookId)?.[1], state }));
    `))
    assert.deepEqual(first.body, { ...authored, revision: 2 }, 'restore returns the original exact formula source')
    assert.deepEqual(first.history.map((version: any) => version.body), [authored, edited, authored])
    assert.deepEqual(first.history.map((version: any) => version.reason), ['baseline', 'edit', 'restore'])
    assert.equal(first.historyPage.currentRevision, 2)
    assert.equal(hasCorePersistedShape(first.state), true)
    const bodyRow = first.state.artifactBodies.find(([id]: [string]) => id === first.id)
    assert.deepEqual(bodyRow[1], { ...authored, revision: 2 }, 'canonical durable current body does not flatten formulas')
    assert.deepEqual(first.workbookBody, { ...workbookAuthored, revision: 2 }, 'non-legacy worksheet IDs retain formula sources and literal formula-looking text')
    assert.deepEqual(calculateSheet(first.workbookBody.sheets[1]).map((row) => row.map((cell) => cell.text)), [['6', '12', '=A1*2']], 'the detail formula resolves its own A1, not Overview!A1')
    assert.deepEqual(first.workbookHistory.map((version: any) => version.body), [workbookAuthored, workbookEdited, workbookAuthored])
    assert.deepEqual(first.workbookHistory.map((version: any) => version.reason), ['baseline', 'edit', 'restore'])
    assert.equal(first.workbookHistoryPage.currentRevision, 2)
    const workbookBodyRow = first.state.artifactBodies.find(([id]: [string]) => id === first.workbookId)
    assert.deepEqual(workbookBodyRow[1], { ...workbookAuthored, revision: 2 }, 'the durable workbook body retains its second-tab formula object')

    const restarted = resultOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const id = ${JSON.stringify(first.id)};
      const workbookId = ${JSON.stringify(first.workbookId)};
      const state = loadState();
      console.log(JSON.stringify({ body: store.artifactContent(owner)[id], historyPage: store.artifactHistoryPage(id, owner), history: state.artifactHistory.find(([artifactId]) => artifactId === id)?.[1], workbookBody: store.artifactContent(owner)[workbookId], workbookHistoryPage: store.artifactHistoryPage(workbookId, owner), workbookHistory: state.artifactHistory.find(([artifactId]) => artifactId === workbookId)?.[1], state }));
    `))
    assert.deepEqual(restarted.body, first.body)
    assert.deepEqual(restarted.history, first.history, 'all source revisions and restore provenance survive a real restart')
    assert.deepEqual(restarted.historyPage, first.historyPage)
    assert.deepEqual(restarted.workbookBody, first.workbookBody)
    assert.deepEqual(restarted.workbookHistory, first.workbookHistory, 'every second-tab formula source revision survives restart')
    assert.deepEqual(restarted.workbookHistoryPage, first.workbookHistoryPage)
    assert.equal(hasCorePersistedShape(restarted.state), true)
  })
}
