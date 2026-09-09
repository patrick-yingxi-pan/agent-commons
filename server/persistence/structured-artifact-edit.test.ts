/** Structured artifact edits are exact-ID, tenant-owned CAS writes. The body,
 * metadata, immutable save origin, grants, and portable representation must
 * remain one durable identity across both persistence backends. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readPortableSnapshot } from './portable.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-structured-edit-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const portableModule = new URL('./portable.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', portable: string, work = '') {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { writePortableSnapshot } = await import(${JSON.stringify(portableModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file,
    },
  })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

function rewriteSnapshot(file: string, backend: 'json' | 'sqlite', work: string) {
  const script = `
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const state = loadState();
    if (!state) throw new Error('expected an existing snapshot');
    ${work}
    saveState(state);
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file,
    },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: structured sheet/slide edits survive CAS, rename, grant, restart, and portable export`, () => {
    const file = join(ROOT, `structured-edit-${backend}`)
    const portable = join(ROOT, `structured-edit-${backend}.portable.json`)
    const owner = `tenant-structured-edit-${backend}`
    const first = ok(boot(file, backend, portable, `
      const owner = ${JSON.stringify(owner)};
      const sheetName = 'quarterly-plan.sheet';
      const slideName = 'quarterly-plan.slides';
      const originalSheet = { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Retention', '42%']] };
      const editedSheet = { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Retention', '47%'], ['Expansion', '12%']], note: 'Edited literal values.' };
      const originalSlides = { type: 'slides', slides: [{ title: 'Launch', bullets: ['One'] }] };
      const editedSlides = { type: 'slides', slides: [{ title: 'Launch', bullets: ['One', 'Two'] }, { title: 'Close', bullets: ['Done'] }] };
      store.applyRelationOp({ kind: 'save-artifact', artifact: { name: sheetName, kind: 'sheet', meta: 'Sheet', body: originalSheet }, sessionTitle: 'Structured edit source' }, owner);
      store.applyRelationOp({ kind: 'save-artifact', artifact: { name: slideName, kind: 'slide', meta: 'Slides', body: originalSlides }, sessionTitle: 'Structured edit source' }, owner);
      const beforeSheet = store.listArtifacts(owner).find(a => a.saveOrigin?.name === sheetName);
      const beforeSlides = store.listArtifacts(owner).find(a => a.saveOrigin?.name === slideName);
      const grant = store.createGrant({ subject: { kind: 'artifact', id: beforeSheet.id }, audience: { kind: 'link' }, tier: 'view' }, owner);
      const renamed = store.renameArtifact(beforeSheet.id, 'quarterly-plan-renamed.sheet', beforeSheet.metadataRevision ?? 0, owner);
      const editNow = Math.max(renamed.editedAt, beforeSlides.editedAt) + 1_000;
      Date.now = () => editNow;
      const sheet = store.updateStructuredArtifactContent(beforeSheet.id, editedSheet, 0, owner);
      const slides = store.updateStructuredArtifactContent(beforeSlides.id, editedSlides, 0, owner);
      const foreign = store.updateStructuredArtifactContent(beforeSheet.id, editedSheet, 1, 'tenant-foreign');
      const invalid = store.updateStructuredArtifactContent(beforeSheet.id, { type: 'sheet', columns: ['Metric'], rows: [['wrong', 'shape']] }, 1, owner);
      let stale = false;
      try { store.updateStructuredArtifactContent(beforeSheet.id, originalSheet, 0, owner); } catch (error) { stale = /changed|conflict|revision/i.test(String(error)); }
      const exported = await store.exportArtifactSpreadsheet(beforeSheet.id, owner);
      writePortableSnapshot(${JSON.stringify(portable)}, loadState());
      console.log(JSON.stringify({
        sheet, slides, foreign, invalid, sheetId: beforeSheet.id, slidesId: beforeSlides.id, beforeSlideEditedAt: beforeSlides.editedAt, renamed, grantId: grant?.id, exported,
        rows: store.listArtifacts(owner).filter(a => a.id === beforeSheet.id || a.id === beforeSlides.id),
        state: loadState(), stale,
      }));
    `))
    assert.ok(first.sheet)
    assert.ok(first.slides)
    assert.equal(first.sheet.revision, 1)
    assert.equal(first.slides.revision, 1)
    assert.equal(first.foreign, undefined, `${backend}: foreign tenant cannot edit`)
    assert.equal(first.invalid, undefined, `${backend}: invalid bounded body is rejected`)
    assert.equal(first.stale, true, `${backend}: stale CAS edit is refused`)
    assert.equal(first.renamed.name, 'quarterly-plan-renamed.sheet')
    assert.deepEqual(first.sheet.rows, [['Retention', '47%'], ['Expansion', '12%']])
    assert.deepEqual(first.slides.slides, [{ title: 'Launch', bullets: ['One', 'Two'] }, { title: 'Close', bullets: ['Done'] }])
    assert.equal(first.exported.filename, 'quarterly-plan-renamed.xlsx')
    assert.equal(first.exported.revision, 1)
    assert.ok(first.grantId)
    assert.equal(first.rows.length, 2, `${backend}: editing does not mint a duplicate row`)
    assert.equal(first.rows.find((a: any) => a.kind === 'sheet').saveOrigin.source, 'Structured edit source')
    assert.equal(first.rows.find((a: any) => a.kind === 'sheet').metadataRevision, 1)
    assert.equal(first.rows.find((a: any) => a.kind === 'sheet').editedAt, Math.max(first.renamed.editedAt, first.beforeSlideEditedAt) + 1_000)
    assert.equal(first.rows.find((a: any) => a.kind === 'slide').editedAt, Math.max(first.renamed.editedAt, first.beforeSlideEditedAt) + 1_000, 'slide edit timestamp is represented')
    assert.equal(first.state.artifactBodies.find(([id]: [string]) => id === first.sheetId)?.[1].revision, 1)
    assert.equal(first.state.artifactMetadata.find(([id]: [string]) => id === first.sheetId)?.[1].revision, 1, 'body edit preserves name revision in durable metadata')
    assert.equal(first.state.artifactMetadata.find(([id]: [string]) => id === first.sheetId)?.[1].editedAt, first.rows.find((a: any) => a.kind === 'sheet').editedAt)
    assert.equal(first.state.artifactMetadata.find(([id]: [string]) => id === first.slidesId)?.[1].revision, 0, 'body-only metadata retains the initial name revision')
    assert.equal(first.state.artifactMetadata.find(([id]: [string]) => id === first.slidesId)?.[1].editedAt, first.rows.find((a: any) => a.kind === 'slide').editedAt)
    const portableState = readPortableSnapshot(portable)
    assert.equal(portableState.artifactBodies?.find(([id]) => id === first.sheetId)?.[1].revision, 1)
    assert.equal(portableState.artifactBodies?.find(([id]) => id === first.slidesId)?.[1].revision, 1)
    assert.equal(portableState.artifactMetadata?.find(([id]) => id === first.sheetId)?.[1].editedAt, first.rows.find((a: any) => a.kind === 'sheet').editedAt)
    assert.equal(portableState.artifactMetadata?.find(([id]) => id === first.slidesId)?.[1].editedAt, first.rows.find((a: any) => a.kind === 'slide').editedAt)

    const second = ok(boot(file, backend, portable, `
      const owner = ${JSON.stringify(owner)};
      const sheet = store.listArtifacts(owner).find(a => a.saveOrigin?.name === 'quarterly-plan.sheet');
      const slides = store.listArtifacts(owner).find(a => a.saveOrigin?.name === 'quarterly-plan.slides');
      let replayConflict = false;
      try { store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'quarterly-plan.sheet', kind: 'sheet', meta: 'Sheet', body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Retention', '42%']] } }, sessionTitle: 'Structured edit source' }, owner); } catch (error) { replayConflict = /changed|conflict|exists/i.test(String(error)); }
      console.log(JSON.stringify({
        replayConflict,
        sheet,
        slides,
        sheetBody: store.artifactContent(owner)[sheet.id],
        slidesBody: store.artifactContent(owner)[slides.id],
        state: loadState(),
      }));
    `))
    assert.equal(second.replayConflict, true, `${backend}: model save replay cannot reset an edited body`)
    assert.equal(second.sheet.id, first.sheetId)
    assert.equal(second.sheet.name, 'quarterly-plan-renamed.sheet')
    assert.equal(second.sheet.editedAt, first.rows.find((a: any) => a.kind === 'sheet').editedAt)
    assert.equal(second.slides.editedAt, first.rows.find((a: any) => a.kind === 'slide').editedAt)
    assert.deepEqual(second.sheetBody.rows, [['Retention', '47%'], ['Expansion', '12%']])
    assert.deepEqual(second.slidesBody.slides, [{ title: 'Launch', bullets: ['One', 'Two'] }, { title: 'Close', bullets: ['Done'] }])
    assert.ok(second.state.grants.some((grant: any) => grant.id === first.grantId), `${backend}: grant survives restart`)
  })

  test(`${backend}: a legacy invalid document name cannot poison restart and becomes editable after rename`, () => {
    const file = join(ROOT, `legacy-invalid-document-name-${backend}`)
    const owner = `tenant-legacy-invalid-document-${backend}`
    const seeded = ok(boot(file, backend, '', `
      const owner = ${JSON.stringify(owner)};
      store.applyRelationOp({
        kind: 'save-artifact',
        artifact: { name: 'legacy-document.md', kind: 'doc', meta: 'Document', body: 'Before edit.' },
        sessionTitle: 'Legacy document source',
      }, owner);
      const row = store.listArtifacts(owner).find(a => a.name === 'legacy-document.md');
      const proposal = store.openSocialProposal({
        subject: { kind: 'artifact', id: row.id },
        delta: { kind: 'artifact-patch', block: 0, text: 'Proposal replacement.' },
        rationale: 'Legacy review.',
      }, owner);
      if (!proposal || typeof proposal !== 'object') throw new Error('proposal was not opened');
      console.log(JSON.stringify({ id: row.id, proposalId: proposal.id }));
    `))
    const invalidName = `${'x'.repeat(241)}.md`
    const rewritten = rewriteSnapshot(file, backend, `
      const artifact = state.graph.extraArtifacts.find(a => a.id === ${JSON.stringify(seeded.id)});
      if (!artifact) throw new Error('seeded artifact missing');
      artifact.name = ${JSON.stringify(invalidName)};
      artifact.saveOrigin = { ...artifact.saveOrigin, name: ${JSON.stringify(invalidName)} };
    `)
    assert.equal(rewritten.status, 0, rewritten.stderr)

    const refused = ok(boot(file, backend, '', `
      const owner = ${JSON.stringify(owner)};
      const row = store.listArtifacts(owner).find(a => a.id === ${JSON.stringify(seeded.id)});
      const before = structuredClone(store.artifactContent(owner)[row.id]);
      const proposalBefore = structuredClone(loadState().socialProposals.find(p => p.id === ${JSON.stringify(seeded.proposalId)}));
      const landing = store.landSocialProposal(${JSON.stringify(seeded.proposalId)}, owner);
      let refusal = '';
      try { store.updateArtifactBlock(row.id, 0, 'This must not persist.', before.revision ?? 0); }
      catch (error) { refusal = error instanceof Error ? error.message : String(error); }
      const state = loadState();
      console.log(JSON.stringify({
        refusal,
        landing,
        proposalBefore,
        proposalAfter: state.socialProposals.find(p => p.id === ${JSON.stringify(seeded.proposalId)}),
        row,
        before,
        after: store.artifactContent(owner)[row.id],
        durableBody: state.artifactBodies.find(([id]) => id === row.id)?.[1],
        durableMetadata: state.artifactMetadata?.find(([id]) => id === row.id),
      }));
    `))
    assert.equal(refused.landing, 'inapplicable', `${backend}: a legacy proposal cannot bypass the invalid-name recovery wall`)
    assert.deepEqual(refused.proposalAfter, refused.proposalBefore, `${backend}: refused landing leaves proposal state and applied base unchanged`)
    assert.match(refused.refusal, /rename this artifact/i, `${backend}: edit explains the required recovery`)
    assert.equal(refused.row.name, invalidName, `${backend}: the legacy name remains readable rather than silently normalized`)
    assert.deepEqual(refused.after, refused.before, `${backend}: refusal leaves the in-memory body unchanged`)
    assert.deepEqual(refused.durableBody, refused.before, `${backend}: refusal leaves the durable body unchanged`)
    assert.equal(refused.durableMetadata, undefined, `${backend}: refusal does not synthesize invalid metadata`)

    const recovered = ok(boot(file, backend, '', `
      const owner = ${JSON.stringify(owner)};
      const row = store.listArtifacts(owner).find(a => a.id === ${JSON.stringify(seeded.id)});
      const before = store.artifactContent(owner)[row.id];
      const renamed = store.renameArtifact(row.id, 'recovered-document.md', row.metadataRevision ?? 0, owner);
      const edited = store.updateArtifactBlock(row.id, 0, 'Edited after recovery.', before.revision ?? 0);
      console.log(JSON.stringify({ renamed, edited, state: loadState() }));
    `))
    assert.equal(recovered.renamed.name, 'recovered-document.md')
    assert.equal(recovered.renamed.metadataRevision, 1)
    assert.equal(recovered.edited.revision, 1)
    assert.equal(recovered.edited.blocks[0].p, 'Edited after recovery.')
    const durableMetadata = recovered.state.artifactMetadata.find(([id]: [string]) => id === seeded.id)?.[1]
    assert.equal(durableMetadata.name, 'recovered-document.md')
    assert.equal(durableMetadata.revision, 1, `${backend}: body edit retains independent rename ordering`)

    const restarted = ok(boot(file, backend, '', `
      const owner = ${JSON.stringify(owner)};
      const row = store.listArtifacts(owner).find(a => a.id === ${JSON.stringify(seeded.id)});
      console.log(JSON.stringify({ row, body: store.artifactContent(owner)[row.id] }));
    `))
    assert.equal(restarted.row.name, 'recovered-document.md')
    assert.equal(restarted.row.metadataRevision, 1)
    assert.equal(restarted.body.revision, 1)
    assert.equal(restarted.body.blocks[0].p, 'Edited after recovery.')
  })
}

test('a failed body commit publishes no artifact event or timestamp', () => {
  const file = join(ROOT, 'structured-edit-failure-json')
  const blocked = join(ROOT, 'structured-edit-failure-blocked')
  const first = ok(boot(file, 'json', '', `
    const owner = 'tenant-structured-edit-failure';
    store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'failure.sheet', kind: 'sheet', meta: 'Sheet', body: { type: 'sheet', columns: ['A'], rows: [['before']] } }, sessionTitle: 'Failure source' }, owner);
    const row = store.listArtifacts(owner).find(a => a.name === 'failure.sheet');
    console.log(JSON.stringify({ id: row.id, row, body: store.artifactContent(owner)[row.id] }));
  `))
  const result = boot(file, 'json', '', `
    const { mkdirSync, renameSync } = await import('node:fs');
    const owner = 'tenant-structured-edit-failure';
    const row = store.listArtifacts(owner).find(a => a.id === ${JSON.stringify(first.id)});
    const events = [];
    const off = store.subscribe(event => { if (event.type === 'artifact.changed') events.push(event); });
    renameSync(process.env.DATA_FILE, ${JSON.stringify(blocked)});
    mkdirSync(process.env.DATA_FILE);
    let failed = false;
    try { store.updateStructuredArtifactContent(row.id, { type: 'sheet', columns: ['A'], rows: [['after']] }, 0, owner); } catch { failed = true; }
    off();
    console.log(JSON.stringify({ failed, events }));
  `)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.failed, true)
  assert.deepEqual(report.events, [], 'reader invalidation waits for durable commit')
  const durable = JSON.parse(readFileSync(blocked, 'utf8'))
  assert.equal(durable.artifactBodies.find(([id]: [string]) => id === first.id)?.[1].revision, 0)
  assert.equal(durable.artifactMetadata.some(([id]: [string]) => id === first.id), false, 'uncommitted recency is absent from disk')
})
