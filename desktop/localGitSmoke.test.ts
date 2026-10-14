import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { extractDocx } from '../src/lib/docxExtraction.ts'

const source = readFileSync(new URL('./localGitSmoke.mjs', import.meta.url), 'utf8')

test('packaged selected comparison proves large-repository fallback and exact source-free saved input', () => {
  const flow = source.slice(source.indexOf('// The explicit one-file workflow'))
  assert.ok(flow.includes('index < 501'), 'real generated index exceeds the whole-review limit')
  assert.ok(flow.includes("largeReview.getByRole('alert')"), 'whole review must visibly refuse')
  const connectionReady = flow.indexOf("await expect(selectedPicker.getByRole('button', { name: `Review changes in ${repositoryName}`, exact: true })).toBeVisible()")
  const connectionRead = flow.indexOf('const selectedConnections = await nativeGitConnections(run.page)')
  assert.ok(connectionReady >= 0 && connectionRead > connectionReady,
    'connection inspection follows rendered native completion, not just the chooser click')
  assert.ok(flow.includes("name: 'Compare file', exact: true"), 'the rendered selected comparison is explicit')
  assert.ok(flow.includes("toContainText('not present in the index'"), 'HEAD-only deletion cannot read an untracked recreation')
  assert.ok(flow.includes("kind: 'git-file-comparison-copy'"), 'exact selected-copy JSON is asserted')
  const laterWrite = flow.indexOf("'selected-source-changed-after-read-v6\\n'")
  const attach = flow.indexOf("name: 'Attach this comparison', exact: true }).click()")
  assert.ok(laterWrite >= 0 && attach > laterWrite, 'source changes before Attach, not just before Send')
  assert.ok(flow.includes('assert.deepEqual(selectedSaved.attachments,'))
  assert.ok(flow.includes("await assert.rejects(stat(selectedSource), { code: 'ENOENT' })"))
  assert.ok(flow.includes('run = await relaunch(executable, userDataPath)'))
  assert.ok(flow.includes('await assertModelFiles(endpoint, [[comparisonName, \'ready\', selectedText]])'))
  assert.ok(flow.includes('await assertIndexUnchanged(repository, selectedIndexBefore)'))
})

test('packaged Git sends use the live hit-tested composer after picker transitions', () => {
  const send = source.slice(source.indexOf('async function send('), source.indexOf('async function assertModelFiles('))
  const click = send.indexOf('await composer.click()')
  const fill = send.indexOf('await composer.fill(text)')
  const retained = send.indexOf('await expect(composer).toHaveValue(text)')
  const enter = send.indexOf("await composer.press('Enter')")
  assert.ok(click > 0 && fill > click && retained > fill && enter > retained,
    'message entry waits for a reachable current composer and retained text before Send')
})

test('packaged local Git sends wait for the exact hydrated transcript before composing', () => {
  const start = source.indexOf('async function send(')
  const end = source.indexOf('\nasync function assertModelFiles', start)
  assert.notEqual(start, -1, 'send helper exists')
  assert.notEqual(end, -1, 'send helper has a stable boundary')
  const helper = source.slice(start, end)
  const priorGate = helper.indexOf('await expect(replies).toHaveCount(expectedPreviousReplies,')
  const fill = helper.indexOf('await composer.fill(text)')
  const submit = helper.indexOf("await composer.press('Enter')")
  const nextGate = helper.indexOf('await expect(replies).toHaveCount(expectedPreviousReplies + 1,')

  assert.ok(priorGate >= 0, 'the prior transcript count is an explicit awaited gate')
  assert.ok(fill > priorGate, 'the composer is not filled until prior replies hydrate')
  assert.ok(submit > fill, 'Enter follows the composer fill')
  assert.ok(nextGate > submit, 'the next exact reply count follows submission')
  assert.doesNotMatch(helper, /replies\.count\(/, 'the baseline is not sampled from a possibly unhydrated DOM')
  assert.match(helper, /expectedPreviousReplies \+ 1/, 'the new reply is checked against the explicit baseline')
})

test('packaged local Git sends pin every saved-history baseline across route and relaunch changes', () => {
  const sends = [...source.matchAll(/await send\(run\.page,\s*'([^']+)',\s*'captured-dotfile-v1',\s*(\d+)\)/g)]
    .map(([, prompt, count]) => [prompt, Number(count)])

  assert.deepEqual(sends, [
    ['Read the attached Git snapshot.', 0],
    ['Read the refreshed Git snapshot.', 1],
    ['Read the saved snapshot after local review.', 2],
    ['Read the Git snapshot after relaunch.', 3],
    ['Read the saved Git snapshot without its source.', 4],
    ['Read the saved Git snapshot after disconnect.', 5],
  ], 'each ordinary send states the complete expected prior reply history')
})

test('packaged untracked Git acceptance proves explicit listing, reviewed saves, and source-free relaunch', async () => {
  const dotfile = '.ordinary-note.md'
  const document = 'untracked-document.docx'
  const flow = source.slice(source.indexOf('// Untracked browsing remains opt-in'), source.indexOf('const documentBrowseReceipt'))
  assert.ok(flow.includes("getByRole('checkbox', { name: 'Browse untracked files', exact: true })"),
    'the packaged journey starts from the explicit opt-in checkbox')
  assert.ok(flow.includes("getByRole('button', { name: 'List untracked paths', exact: true }).click()"),
    'enumeration requires its own action')
  assert.ok(flow.includes("getByRole('list', { name: 'Untracked repository paths', exact: true })"),
    'the separate untracked listing is visibly identified')
  assert.ok(flow.includes("`${dotfilePath} Untracked file`") && flow.includes("`${documentPath} Untracked file`"),
    'ordinary dotfiles and real documents are separately selected from untracked entries')
  assert.ok(flow.includes("not.toContainText('ignored-secret.md')"), 'ignored entries never appear in the candidate listing')
  assert.ok(flow.indexOf("not.toContainText('untracked-dotfile-reviewed-v1')") < flow.indexOf("getByRole('button', { name: 'Attach saved copy', exact: true }).click()"),
    'enumerating paths does not expose candidate bodies before selection')
  assert.ok(flow.includes('untracked-dotfile-replaced-after-review-v2')
    && flow.includes('untracked-document-replaced-after-review-v2'),
  'both selected source files change after preview and before Attach')
  assert.ok(flow.includes('await assertIndexUnchanged(repository, untrackedIndexBefore)'),
    'the full index and split-index bytes and mtimes are compared after untracked capture')
  assert.ok(source.includes("await assert.rejects(stat(path), { code: 'ENOENT' }, 'untracked source is absent after full relaunch')"),
    'the original selected paths are checked absent after the packaged process restarts')
  assert.ok(source.includes("await send(run.page, 'Read the reviewed untracked saved copies after relaunch.'"),
    'post-relaunch model input is read from the saved conversation copies')
  const relaunched = source.slice(source.indexOf('run = await relaunch(executable, userDataPath)'))
  const untrackedNavigation = relaunched.indexOf('await run.page.goto(`${run.origin}/s/${encodeURIComponent(untrackedSession.id)}`)')
  const untrackedSend = relaunched.indexOf("await send(run.page, 'Read the reviewed untracked saved copies after relaunch.'")
  assert.ok(untrackedNavigation >= 0 && untrackedNavigation < untrackedSend,
    'relaunch restores the exact untracked conversation before checking its prior transcript or composing')

  const text = 'untracked-document-reviewed-v1 · café 世界 😀'
  const actual = await extractDocx(docxFixture({ paragraphs: [text] }))
  assert.deepEqual(actual, { text, documentImport: { format: 'docx', status: 'ready' } },
    'the packaged document workflow fixture is a real DOCX with a parser-verified exact text oracle')
})

test('Git model-file oracle preserves exact selected image metadata beside text rows', () => {
  assert.ok(source.includes("file.status === 'image-ready'"), 'the model-file projection keeps image rows instead of dropping them')
  assert.ok(source.includes('image_index: file.image_index, width: file.width, height: file.height'))
  assert.ok(source.includes("name: `src/${trackedImage.name}`, status: 'image-ready', image_index: 1, width: 180, height: 90"))
  assert.ok(source.includes("name: untrackedImage.name, status: 'image-ready', image_index: 1, width: 64, height: 32"),
    'untracked image input remains asserted after source removal and relaunch')
})
