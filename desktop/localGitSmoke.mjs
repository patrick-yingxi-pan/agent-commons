import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect } from '@playwright/test'
import { bundledGitDirectory } from './bundledGit.mjs'
import { localGitCommandEnvironment } from './localGitReader.mjs'
import { smokeLocalDocumentBrowse, verifyLocalDocumentBrowseRelaunch } from './localDocumentBrowseSmoke.mjs'
import {
  localImageBrowseFixture, localImageOcrFixture, smokeLocalImageBrowse, smokeLocalImageOcrDocument,
  verifyLocalImageBrowseRelaunch, verifyLocalImageOcrDocumentRelaunch,
} from './localImageBrowseSmoke.mjs'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'

const TIMEOUT_MS = 30_000

function git(executable, cwd, ...args) {
  const result = spawnSync(executable, ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
    cwd, env: localGitCommandEnvironment(), encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return result.stdout
}

async function indexState(repository) {
  const metadata = join(repository, '.git')
  const names = (await readdir(metadata)).filter(name => name === 'index' || name.startsWith('sharedindex.')).sort()
  assert.ok(names.includes('index'), 'generated repository has an index')
  assert.ok(names.some(name => name.startsWith('sharedindex.')), 'generated repository uses a split shared index')
  return Promise.all(names.map(async name => ({
    name,
    bytes: await readFile(join(metadata, name)),
    mtimeNs: (await stat(join(metadata, name), { bigint: true })).mtimeNs,
  })))
}

async function assertIndexUnchanged(repository, before) {
  const after = await indexState(repository)
  assert.deepEqual(after.map(item => item.name), before.map(item => item.name), 'index and split shared-index files remain unchanged')
  for (let index = 0; index < before.length; index += 1) {
    assert.deepEqual(after[index].bytes, before[index].bytes, `${before[index].name} bytes remain unchanged`)
    assert.equal(after[index].mtimeNs, before[index].mtimeNs, `${before[index].name} mtime remains unchanged`)
  }
}

async function configureRepositoryDialog(app, repository) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async (_owner, options) => {
      if (options.title !== 'Connect repository' || options.properties.join(',') !== 'openDirectory') {
        throw new Error('Expected explicit native repository connection selection')
      }
      return { canceled: false, filePaths: [path] }
    }
  }, repository)
}

async function nativeGitConnections(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/me')
    if (!response.ok) throw new Error('The local Git identity precondition failed.')
    const identity = await response.json()
    return window.agentCommonsDesktop.context.localGit.list({ namespace: identity.tenant.id, userId: identity.user.id })
  })
}

async function readWorkspace(page, sessionId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`Local Git session read: HTTP ${response.status}`)
    return (await response.json()).workspace
  }, sessionId)
}

function gitFolder(workspace, connectionId) {
  return workspace?.workspaces?.flatMap(item => item.folders ?? [])
    .find(item => item.id === `ui-host::${connectionId}`)
}

async function send(page, text, expectedReply, expectedPreviousReplies) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  const replies = page.locator('[data-turn]').filter({ hasText: expectedReply })
  await expect(replies).toHaveCount(expectedPreviousReplies, { timeout: TIMEOUT_MS })
  // Picker dismissal may replace the composer while its preview pane opens.
  // A hit-tested click waits for the reachable current field before typing.
  await composer.click()
  await composer.fill(text)
  await expect(composer).toHaveValue(text)
  await composer.press('Enter')
  await expect(replies).toHaveCount(expectedPreviousReplies + 1, { timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
}

async function assertModelFiles(endpoint, expected) {
  const actual = endpoint.documents.at(-1)?.attached_files ?? []
  assert.deepEqual(actual.map(file => file.status === 'image-ready'
    ? { name: file.name, status: file.status, image_index: file.image_index, width: file.width, height: file.height }
    : [file.name.split('/').at(-1), file.status, file.text]), expected)
  assert.equal(JSON.stringify(endpoint.requests).includes('must-never-enter-model'), false,
    'untracked and ignored source markers never enter model requests')
}

/** Packaged Git workflow. Only the native dialog result is fixture-controlled;
 * bundled Git, repository reader, main IPC, preload bridge, renderer, backend,
 * persisted workspace and model transport are the actual packaged code. */
export async function smokePackagedLocalGit({ executable, fixtureRoot, userDataPath, run, providerId, endpoint, relaunch }) {
  if (process.platform !== 'darwin') throw new Error('Packaged local Git smoke requires macOS bundled Git.')
  const repository = join(fixtureRoot, 'local-git-smoke-repository')
  const heldRepository = `${repository}-held`
  const gitExecutable = join(bundledGitDirectory({ packaged: false }), 'git')
  const trackedImage = localImageBrowseFixture('svg')
  const untrackedImage = localImageBrowseFixture('ico')
  const trackedOcrPath = 'src/tracked-ocr.png'
  const untrackedOcrPath = 'untracked-ocr.png'
  const trackedOcrBytes = await localImageOcrFixture()
  const untrackedOcrBytes = await localImageOcrFixture()
  await mkdir(join(repository, '.config'), { recursive: true })
  await mkdir(join(repository, 'src'), { recursive: true })
  await writeFile(join(repository, '.gitignore'), 'ignored-secret.md\n')
  await writeFile(join(repository, '.config', 'tracked.md'), 'captured-dotfile-v1\n')
  await writeFile(join(repository, 'src', 'nested.md'), 'captured-nested-index-v1\n')
  await writeFile(join(repository, 'ignored-secret.md'), 'must-never-enter-model ignored content')
  await writeFile(join(repository, 'untracked-secret.md'), 'must-never-enter-model untracked content')
  await writeFile(join(repository, '.ordinary-note.md'), 'untracked-dotfile-reviewed-v1\n')
  await writeFile(join(repository, 'untracked-document.docx'), docxFixture({ paragraphs: ['untracked-document-reviewed-v1 · café 世界 😀'] }))
  git(gitExecutable, repository, 'init', '--template=', '--initial-branch=main', '.')
  git(gitExecutable, repository, 'add', '--', '.gitignore', '.config/tracked.md', 'src/nested.md')
  git(gitExecutable, repository, 'update-index', '--split-index')
  await writeFile(join(repository, 'src', 'nested.md'), 'captured-nested-working-v1\n')
  const indexBeforeAttach = await indexState(repository)

  const session = await run.page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error(`Local Git conversation precondition: HTTP ${response.status}`)
    return response.json()
  }, providerId)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(session.id)}`)
  await configureRepositoryDialog(run.app, repository)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const picker = run.page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Repository/ }).click()
  const nativePicker = picker.locator('[data-native-git-picker]')
  const remember = nativePicker.getByRole('checkbox', { name: /Remember this connection/ })
  await expect(remember).toHaveAttribute('aria-checked', 'false')
  await remember.click()
  await expect(remember).toHaveAttribute('aria-checked', 'true')
  await nativePicker.getByRole('button', { name: /Choose a repository from this computer/ }).click()
  const repositoryName = repository.split('/').at(-1)
  await expect(nativePicker.getByRole('button', { name: `Attach ${repositoryName}`, exact: true })).toBeVisible()
  let connections = await nativeGitConnections(run.page)
  assert.deepEqual(connections.map(({ name, remembered }) => [name, remembered]), [[repositoryName, true]])
  const connectionId = connections[0].id
  assert.match(connectionId, /^GIT_[A-F0-9]{32}$/)
  const beforeAttach = await readWorkspace(run.page, session.id)
  assert.equal(JSON.stringify(beforeAttach ?? {}).includes(connectionId), false,
    'connecting and listing metadata does not capture or attach repository contents')
  await nativePicker.getByRole('button', { name: `Attach ${repositoryName}`, exact: true }).click()
  await expect(picker).toContainText('1 added', { timeout: TIMEOUT_MS })
  await picker.getByRole('button', { name: 'Done', exact: true }).click()

  const group = run.page.locator(`[data-workspace-folder="ui-host::${connectionId}"]:visible`)
  await expect(group).toBeVisible()
  await group.getByRole('button', { name: /^src\/nested\.md(?: |$)/ }).click()
  const attachedWorkspace = await readWorkspace(run.page, session.id)
  const attached = gitFolder(attachedWorkspace, connectionId)
  assert.ok(attached?.gitSnapshot, 'Attach persists a distinct gitSnapshot, not a live repository or local folder snapshot')
  assert.equal(attached.localSnapshot, undefined)
  assert.deepEqual(attached.gitSnapshot.files.map(file => file.path), ['.config/tracked.md', '.gitignore', 'src/nested.md'])
  assert.equal(attached.gitSnapshot.files.find(file => file.path === 'src/nested.md').snapshot.text, 'captured-nested-working-v1\n',
    'capture reads current tracked working bytes, including edits made after staging')
  await assertIndexUnchanged(repository, indexBeforeAttach)

  // Change the source after Attach but before sending: the first turn must use
  // the saved capture, not implicitly reread the repository.
  await writeFile(join(repository, 'src', 'nested.md'), 'captured-nested-v2-before-refresh\n')
  await send(run.page, 'Read the attached Git snapshot.', 'captured-dotfile-v1', 0)
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-working-v1\n'],
  ])
  assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false, 'native absolute repository paths never enter model requests')

  // Refresh explicitly to save the later tracked edit, then prove that refreshed
  // saved bytes—not the current source—supply model input.
  const indexBeforeRefresh = await indexState(repository)
  await group.getByRole('button', { name: /^Refresh/ }).click()
  const preview = run.page.locator('[data-folder-snapshot-preview]:visible')
  await expect(preview).toContainText('captured-nested-v2-before-refresh', { timeout: TIMEOUT_MS })
  await assertIndexUnchanged(repository, indexBeforeRefresh)
  const refreshedWorkspace = await readWorkspace(run.page, session.id)
  const refreshed = gitFolder(refreshedWorkspace, connectionId)
  assert.equal(refreshed.gitSnapshot.files.find(file => file.path === 'src/nested.md').snapshot.text,
    'captured-nested-v2-before-refresh\n')
  await writeFile(join(repository, 'src', 'nested.md'), 'review-working-only-v3\n')
  await send(run.page, 'Read the refreshed Git snapshot.', 'captured-dotfile-v1', 1)
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
  ])

  const beforeReview = await readWorkspace(run.page, session.id)
  const modelRequestsBeforeReview = endpoint.requests.length
  const indexBeforeReview = await indexState(repository)
  await run.page.goto(run.origin + '/contexts/' + encodeURIComponent(connectionId))
  const reviewPanel = run.page.locator('[data-local-git-review]')
  await expect(reviewPanel).toBeVisible()
  await expect(reviewPanel.locator('[data-local-git-review-result]')).toHaveCount(0,
    'opening repository detail does not read or restore a review result')
  await reviewPanel.getByRole('button', { name: 'Review changes', exact: true }).click()
  const reviewResult = reviewPanel.locator('[data-local-git-review-result]')
  await expect(reviewResult).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(reviewResult).toContainText('No commit yet')
  await expect(reviewResult).toContainText('main')
  await run.page.getByLabel('Compare').selectOption('staged')
  await run.page.getByLabel('Changed file').selectOption('src/nested.md')
  await expect(reviewResult).toContainText('Added')
  await expect(reviewResult.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await expect(run.page.getByLabel('Review view')).toHaveValue('changes')
  await expect(reviewResult.locator('[data-diff-lines] tr[data-diff-kind="add"]'),
    'the packaged default changed-line view exposes captured index bytes').toContainText('captured-nested-index-v1')
  await run.page.getByLabel('Review view').selectOption('full')
  assert.equal(await reviewResult.getByLabel('Index · Regular file').textContent(), 'captured-nested-index-v1\n',
    'staged review shows the exact index bytes')
  await run.page.getByLabel('Compare').selectOption('unstaged')
  await expect(run.page.getByLabel('Review view')).toHaveValue('changes')
  await expect(reviewResult.locator('[data-diff-lines] tr[data-diff-kind="delete"]')).toContainText('captured-nested-index-v1')
  await expect(reviewResult.locator('[data-diff-lines] tr[data-diff-kind="add"]')).toContainText('review-working-only-v3')
  await run.page.getByLabel('Review view').selectOption('full')
  assert.equal(await reviewResult.getByLabel('Index · Regular file').textContent(), 'captured-nested-index-v1\n',
    'unstaged review begins from the exact staged index bytes')
  assert.equal(await reviewResult.getByLabel('Working tree · Regular file').textContent(), 'review-working-only-v3\n',
    'unstaged review shows the exact later working-tree bytes')
  assert.equal(endpoint.requests.length, modelRequestsBeforeReview, 'review itself makes no model request')
  assert.deepEqual(await readWorkspace(run.page, session.id), beforeReview,
    'review is transient and cannot alter the saved conversation snapshot')
  await assertIndexUnchanged(repository, indexBeforeReview)
  await run.page.goto(run.origin + '/s/' + encodeURIComponent(session.id))
  await send(run.page, 'Read the saved snapshot after local review.', 'captured-dotfile-v1', 2)
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
  ])
  assert.equal(JSON.stringify(endpoint.requests).includes('review-working-only-v3'), false,
    'transient review text never enters model input')
  assert.equal(JSON.stringify(endpoint.requests).includes('captured-nested-index-v1'), false,
    'staged-only review text never enters model input')

  // Build real staged rename candidates only inside the generated repository.
  // The explicit fixture identity and --no-gpg-sign keep this commit independent
  // of user Git configuration, credentials, hooks and signing tools.
  const renameDirectory = join(repository, 'rename-fixture')
  await mkdir(renameDirectory, { recursive: true })
  const exactOldPath = 'rename-fixture/exact-before.md'
  const exactNewPath = 'rename-fixture/exact-after.md'
  const editedOldPath = 'rename-fixture/edited-before.md'
  const editedNewPath = 'rename-fixture/edited-after.md'
  const exactText = 'PACKAGED_RENAME_EXACT_CANARY_6f9c\nPreserve this exact captured body.\n'
  const stableLines = [
    `PACKAGED_RENAME_STABLE_1 ${'line-content-'.repeat(5)}`,
    `PACKAGED_RENAME_STABLE_2 ${'line-content-'.repeat(5)}`,
    `PACKAGED_RENAME_STABLE_3 ${'line-content-'.repeat(5)}`,
  ]
  const editedOldText = [...stableLines, `PACKAGED_RENAME_OLD_BODY ${'before-'.repeat(4)}`].join('\n') + '\n'
  const editedNewText = [...stableLines, `PACKAGED_RENAME_NEW_BODY ${'after-'.repeat(4)}`].join('\n') + '\n'
  await writeFile(join(repository, exactOldPath), exactText)
  await writeFile(join(repository, editedOldPath), editedOldText)
  const fixtureIdentity = [
    '-c', 'user.name=Agent Commons Packaged Fixture',
    '-c', 'user.email=packaged-git-fixture@example.test',
    '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null',
  ]
  git(gitExecutable, repository, ...fixtureIdentity, 'add', '--', exactOldPath, editedOldPath)
  git(gitExecutable, repository, ...fixtureIdentity, 'commit', '--no-gpg-sign', '-m', 'Create packaged rename fixture base')
  await rename(join(repository, exactOldPath), join(repository, exactNewPath))
  await rename(join(repository, editedOldPath), join(repository, editedNewPath))
  await writeFile(join(repository, editedNewPath), editedNewText)
  git(gitExecutable, repository, 'add', '-A', '--', exactOldPath, exactNewPath, editedOldPath, editedNewPath)

  const beforeRenameReview = await readWorkspace(run.page, session.id)
  const modelRequestsBeforeRenameReview = endpoint.requests.length
  const indexBeforeRenameReview = await indexState(repository)
  await run.page.goto(run.origin + '/contexts/' + encodeURIComponent(connectionId))
  const renameReviewPanel = run.page.locator('[data-local-git-review]')
  await expect(renameReviewPanel).toBeVisible()
  // A full navigation reloads the renderer and discards the previous review.
  await expect(renameReviewPanel.locator('[data-local-git-review-result]')).toHaveCount(0)
  await renameReviewPanel.getByRole('button', { name: 'Review changes', exact: true }).click()
  const renameResult = renameReviewPanel.locator('[data-local-git-review-result]')
  await expect(renameResult).toBeVisible({ timeout: TIMEOUT_MS })
  const renameCompare = renameResult.getByLabel('Compare')
  const renameFile = renameResult.getByLabel('Changed file')
  await renameCompare.selectOption('staged')
  const grouping = renameResult.getByRole('checkbox', { name: /^Group possible renames/ })
  await expect(grouping).not.toBeChecked()

  // Raw mode is the default: each staged deletion remains independently
  // selectable and shows its exact HEAD body against an absent Index side.
  await renameFile.selectOption(exactOldPath)
  await expect(renameResult.getByRole('heading', { name: exactOldPath, exact: true })).toBeVisible()
  await renameResult.getByLabel('Review view').selectOption('full')
  assert.equal(await renameResult.getByLabel('HEAD · Regular file').textContent(), exactText)
  await expect(renameResult.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await renameFile.selectOption(editedOldPath)
  await expect(renameResult.getByRole('heading', { name: editedOldPath, exact: true })).toBeVisible()
  await renameResult.getByLabel('Review view').selectOption('changes')
  await expect(renameResult.locator('[data-diff-lines] tr[data-diff-kind="delete"]')
    .filter({ hasText: 'PACKAGED_RENAME_OLD_BODY' })).toHaveAttribute('data-diff-kind', 'delete')

  await expect(grouping).toContainText('(2)')
  await grouping.check()
  await expect(grouping).toBeChecked()
  await expect(renameResult.getByRole('heading', {
    name: `Possible rename: ${editedOldPath} → ${editedNewPath}`, exact: true,
  })).toBeVisible()
  await expect(renameResult.locator('[data-git-rename-match]')).toContainText(/\d+% shared line bytes/)
  const sharedPercent = Number((await renameResult.locator('[data-git-rename-match]').textContent())?.match(/\d+/)?.[0])
  assert.ok(sharedPercent >= 80, 'edited suggestion discloses at least 80% shared line bytes')
  const groupedChanges = renameResult.locator('[data-diff-lines] tr[data-diff-kind]')
  await expect(groupedChanges.filter({ hasText: 'PACKAGED_RENAME_OLD_BODY' })).toHaveAttribute('data-diff-kind', 'delete')
  await expect(groupedChanges.filter({ hasText: 'PACKAGED_RENAME_NEW_BODY' })).toHaveAttribute('data-diff-kind', 'add')
  await renameResult.getByLabel('Review view').selectOption('full')
  assert.equal(await renameResult.getByLabel(`HEAD · ${editedOldPath} · Regular file`).textContent(), editedOldText)
  assert.equal(await renameResult.getByLabel(`Index · ${editedNewPath} · Regular file`).textContent(), editedNewText)
  await renameFile.selectOption(exactNewPath)
  await expect(renameResult.getByRole('heading', {
    name: `Possible rename: ${exactOldPath} → ${exactNewPath}`, exact: true,
  })).toBeVisible()
  await expect(renameResult.locator('[data-git-rename-match]')).toContainText('Identical captured text')
  await renameResult.getByLabel('Review view').selectOption('full')
  assert.equal(await renameResult.getByLabel(`HEAD · ${exactOldPath} · Regular file`).textContent(), exactText)
  assert.equal(await renameResult.getByLabel(`Index · ${exactNewPath} · Regular file`).textContent(), exactText)

  // Opt-out restores both original staged rows. The pre-existing nested edit
  // remains an independent unstaged comparison and is never grouped.
  await grouping.uncheck()
  await expect(renameResult.getByRole('heading', { name: exactNewPath, exact: true })).toBeVisible()
  const rawRenameOptions = renameFile.locator('option')
  await expect(rawRenameOptions.filter({ hasText: exactOldPath })).toHaveCount(1)
  await expect(rawRenameOptions.filter({ hasText: exactNewPath })).toHaveCount(1)
  await expect(rawRenameOptions.filter({ hasText: editedOldPath })).toHaveCount(1)
  await expect(rawRenameOptions.filter({ hasText: editedNewPath })).toHaveCount(1)
  await renameCompare.selectOption('unstaged')
  await expect(renameResult.getByRole('checkbox', { name: /^Group possible renames/ })).toHaveCount(0)
  await renameFile.selectOption('src/nested.md')
  await expect(renameResult.getByRole('heading', { name: 'src/nested.md', exact: true })).toBeVisible()
  await renameResult.getByLabel('Review view').selectOption('full')
  assert.equal(await renameResult.getByLabel('Index · Regular file').textContent(), 'captured-nested-index-v1\n')
  assert.equal(await renameResult.getByLabel('Working tree · Regular file').textContent(), 'review-working-only-v3\n')
  assert.equal(endpoint.requests.length, modelRequestsBeforeRenameReview, 'local rename review and grouping never dispatch a model request')
  assert.deepEqual(await readWorkspace(run.page, session.id), beforeRenameReview,
    'rename review and grouping do not mutate the saved conversation workspace')
  await assertIndexUnchanged(repository, indexBeforeRenameReview)

  // A selected working file is a separate portable attachment, not a live Git
  // handle. Only the explicit Attach action persists exactly the previewed text.
  // Add the image fixtures after the original snapshot and review assertions so
  // their coverage cannot dilute the pre-existing exact tracked-path baseline.
  await writeFile(join(repository, 'src', trackedImage.name), trackedImage.bytes, { mode: 0o600 })
  await writeFile(join(repository, trackedOcrPath), trackedOcrBytes, { mode: 0o600 })
  await writeFile(join(repository, untrackedImage.name), untrackedImage.bytes, { mode: 0o600 })
  git(gitExecutable, repository, 'add', '--', `src/${trackedImage.name}`, trackedOcrPath)
  const browseSession = await run.page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error('Could not create the isolated Git browsing conversation.')
    return response.json()
  }, providerId)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(browseSession.id)}`)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const browsePicker = run.page.getByRole('dialog', { name: 'Add context' })
  await browsePicker.getByRole('button', { name: /^Repository/ }).click()
  await browsePicker.getByRole('button', { name: `Browse files in ${repositoryName}`, exact: true }).click()
  const browser = browsePicker.locator('[data-local-git-browser]')
  await expect(browser.locator('[data-local-git-browser-listing]')).toHaveCount(0)
  await expect(browser.locator('[data-local-git-file-preview]')).toHaveCount(0)
  const beforeBrowse = await readWorkspace(run.page, browseSession.id)
  const beforeBrowseModel = endpoint.requests.length
  const beforeBrowseIndex = await indexState(repository)
  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.getByRole('list', { name: 'Tracked repository paths' })).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(browser.locator('[data-local-git-file-preview]')).toHaveCount(0)
  await expect(browser).not.toContainText('ignored-secret.md')
  await expect(browser).not.toContainText('untracked-secret.md')
  await browser.getByRole('button', { name: 'src/nested.md Tracked file', exact: true }).click()
  const filePreview = browser.getByRole('region', { name: 'Preview of src/nested.md', exact: true })
  await expect(filePreview).toHaveText('review-working-only-v3\n', { timeout: TIMEOUT_MS })
  assert.equal(await filePreview.textContent(), 'review-working-only-v3\n')
  assert.deepEqual(await readWorkspace(run.page, browseSession.id), beforeBrowse)
  assert.equal(endpoint.requests.length, beforeBrowseModel, 'listing and preview cannot call a model')
  await writeFile(join(repository, 'src', 'nested.md'), 'browse-source-changed-after-preview-v4\n')
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(browsePicker).toContainText('1 added')
  await run.page.screenshot({ path: join(fixtureRoot, 'local-git-browse.png') })
  const trackedImageReceipt = await smokeLocalImageBrowse({
    run, root: repository, path: `src/${trackedImage.name}`, kind: 'svg', source: 'git-tracked',
    browser, picker: browsePicker, sessionId: browseSession.id, endpoint, listKind: 'Tracked file',
    previewSelector: '[data-local-git-file-preview]', pickerAddedCount: 2,
    verifySourceMetadata: () => assertIndexUnchanged(repository, beforeBrowseIndex),
  })
  const heldTrackedImage = join(fixtureRoot, 'tracked-image-source-held.svg')
  await rename(trackedImageReceipt.sourcePath, heldTrackedImage)
  await assertIndexUnchanged(repository, beforeBrowseIndex)
  const savedBrowse = await readWorkspace(run.page, browseSession.id)
  assert.ok(JSON.stringify(savedBrowse).includes('review-working-only-v3'))
  assert.equal(JSON.stringify(savedBrowse).includes('browse-source-changed-after-preview-v4'), false)
  assert.equal(JSON.stringify(savedBrowse).includes(fixtureRoot), false)
  assert.equal(endpoint.requests.length, beforeBrowseModel + 1, 'only explicit Send calls a model after local image preview')
  await assertIndexUnchanged(repository, beforeBrowseIndex)
  await assertModelFiles(endpoint, [
    ['nested.md', 'ready', 'review-working-only-v3\n'],
    { name: `src/${trackedImage.name}`, status: 'image-ready', image_index: 1, width: 180, height: 90 },
  ])
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(browseSession.id)}`)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const trackedOcrPicker = run.page.getByRole('dialog', { name: 'Add context', exact: true })
  await trackedOcrPicker.getByRole('button', { name: /^Repository/ }).click()
  await trackedOcrPicker.getByRole('button', { name: `Browse files in ${repositoryName}`, exact: true }).click()
  const trackedOcrBrowser = trackedOcrPicker.locator('[data-local-git-browser]')
  await trackedOcrBrowser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(trackedOcrBrowser.getByRole('list', { name: 'Tracked repository paths', exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
  const trackedOcrReceipt = await smokeLocalImageOcrDocument({
    run, root: repository, path: trackedOcrPath, bytes: trackedOcrBytes, source: 'git-tracked',
    browser: trackedOcrBrowser, endpoint, listKind: 'Tracked file', previewSelector: '[data-local-git-file-preview]',
    verifySourceMetadata: () => assertIndexUnchanged(repository, beforeBrowseIndex),
  })
  await writeFile(trackedOcrReceipt.sourcePath, trackedOcrBytes, { mode: 0o600 })

  // A conversation can explicitly save one captured comparison as an ordinary
  // text attachment. Mutating only the working file after preview proves Attach
  // adopts that copy without taking another native review read.
  const comparisonSession = await run.page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error('Could not create the isolated Git comparison conversation.')
    return response.json()
  }, providerId)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(comparisonSession.id)}`)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const comparisonPicker = run.page.getByRole('dialog', { name: 'Add context' })
  await comparisonPicker.getByRole('button', { name: /^Repository/ }).click()
  await comparisonPicker.getByRole('button', { name: `Review changes in ${repositoryName}`, exact: true }).click()
  const comparisonReview = comparisonPicker.locator('[data-local-git-review]')
  await expect(comparisonReview).toBeVisible()
  const comparisonModelBefore = endpoint.requests.length
  const comparisonIndexBefore = await indexState(repository)
  await comparisonReview.getByRole('button', { name: 'Review changes', exact: true }).click()
  const comparisonResult = comparisonReview.locator('[data-local-git-review-result]')
  await expect(comparisonResult).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(comparisonResult.getByLabel('Compare')).toHaveValue('staged', { timeout: TIMEOUT_MS })
  await comparisonResult.getByLabel('Compare').selectOption('unstaged')
  await comparisonResult.getByLabel('Changed file').selectOption('src/nested.md')
  await expect(comparisonResult.getByLabel('Review view')).toHaveValue('changes')
  const comparisonCopy = comparisonResult.locator('[data-git-comparison-copy]')
  await expect(comparisonCopy).toBeVisible()
  await comparisonCopy.getByText('Saved comparison contents', { exact: true }).click()
  const comparisonTextRegion = comparisonCopy.locator('[data-git-comparison-copy-text]')
  await expect(comparisonTextRegion).toBeVisible()
  const comparisonText = await comparisonTextRegion.textContent()
  assert.equal(typeof comparisonText, 'string')
  const comparisonName = 'git-unstaged-src__nested.md.comparison.json'
  const comparison = JSON.parse(comparisonText)
  assert.deepEqual(comparison, {
    version: 1,
    kind: 'git-comparison-copy',
    repositoryName,
    capturedAt: comparison.capturedAt,
    head: { ref: 'refs/heads/main', oid: git(gitExecutable, repository, 'rev-parse', 'HEAD').trim() },
    comparison: 'unstaged',
    paths: { before: 'src/nested.md', after: 'src/nested.md' },
    change: 'modified',
    before: { kind: 'text', text: 'captured-nested-index-v1\n', mode: '100644' },
    after: { kind: 'text', text: 'browse-source-changed-after-preview-v4\n', mode: '100644' },
  }, 'the saved comparison contains exact captured Index and Working tree sides')
  assert.equal(new Date(comparison.capturedAt).toISOString(), comparison.capturedAt,
    'saved comparison time is the captured read time in stable ISO form')
  assert.equal(JSON.stringify(comparison, null, 2), comparisonText,
    'the preview is the complete stable pretty-printed JSON copy')
  assert.equal(endpoint.requests.length, comparisonModelBefore, 'reviewing a comparison never sends a model request')

  await writeFile(join(repository, 'src', 'nested.md'), 'comparison-source-changed-after-preview-v5\n')
  assert.equal(await comparisonTextRegion.textContent(), comparisonText,
    'later source edits do not alter the explicit comparison preview')
  await comparisonCopy.getByRole('button', { name: 'Attach this comparison', exact: true }).click()
  await expect(comparisonPicker).toContainText('1 added', { timeout: TIMEOUT_MS })
  const comparisonSaved = await readWorkspace(run.page, comparisonSession.id)
  assert.deepEqual(comparisonSaved.attachments, [{
    id: comparisonSaved.attachments[0].id,
    label: comparisonName,
    kind: 'file',
    source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
    previewText: comparisonText,
  }], 'Attach persists exactly the selected comparison JSON as ordinary file text')
  assert.equal(JSON.stringify(comparisonSaved).includes(fixtureRoot), false,
    'the saved comparison contains no native repository path')
  assert.equal(endpoint.requests.length, comparisonModelBefore,
    'explicit Attach persists the comparison without automatically sending it')
  await assertIndexUnchanged(repository, comparisonIndexBefore)

  await comparisonPicker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(comparisonPicker).toHaveCount(0)
  await send(run.page, 'Read the saved Git comparison.', 'Read supplied attachment:', 0)
  assert.equal(endpoint.requests.length, comparisonModelBefore + 1,
    'only the separate explicit Send makes a model request')
  await assertModelFiles(endpoint, [[comparisonName, 'ready', comparisonText]])
  assert.ok(endpoint.requests.at(-1).messages.some(message =>
    typeof message.content === 'string' && message.content.includes(JSON.stringify(comparisonText))),
  'the explicit model prompt contains the JSON-escaped exact saved comparison text')
  await assertIndexUnchanged(repository, comparisonIndexBefore)

  // Untracked browsing remains opt-in, with listing and each selected preview
  // separate from the conversation-only Attach action. The generated fixtures
  // cover an ordinary dotfile and the real packaged DOCX worker.
  const untrackedSession = await run.page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error('Could not create the isolated untracked Git browsing conversation.')
    return response.json()
  }, providerId)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(untrackedSession.id)}`)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const untrackedPicker = run.page.getByRole('dialog', { name: 'Add context' })
  await untrackedPicker.getByRole('button', { name: /^Repository/ }).click()
  await untrackedPicker.getByRole('button', { name: `Browse files in ${repositoryName}`, exact: true }).click()
  const untrackedIntake = untrackedPicker.locator('[data-local-git-untracked-intake]')
  const untrackedToggle = untrackedIntake.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
  const trackedBrowser = untrackedPicker.locator('[data-local-git-browser]')
  const untrackedBrowser = untrackedPicker.locator('[data-local-git-untracked-browser]')
  await expect(untrackedToggle).toHaveAttribute('aria-checked', 'false')
  const untrackedBefore = await readWorkspace(run.page, untrackedSession.id)
  const untrackedModelBefore = endpoint.requests.length
  const untrackedIndexBefore = await indexState(repository)
  await trackedBrowser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  const trackedListing = trackedBrowser.getByRole('list', { name: 'Tracked repository paths', exact: true })
  await expect(trackedListing).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(trackedListing).not.toContainText('.ordinary-note.md')
  await expect(trackedListing).not.toContainText('untracked-document.docx')
  await expect(trackedListing).not.toContainText('ignored-secret.md')
  await expect(untrackedBrowser.getByRole('button', { name: 'List untracked paths', exact: true })).toHaveCount(0)
  assert.deepEqual(await readWorkspace(run.page, untrackedSession.id), untrackedBefore,
    'default tracked listing neither captures untracked bodies nor mutates the destination')
  assert.equal(endpoint.requests.length, untrackedModelBefore, 'listing tracked files makes no model request')

  await untrackedToggle.click()
  await expect(untrackedToggle).toHaveAttribute('aria-checked', 'true')
  await expect(untrackedBrowser.getByRole('list', { name: 'Untracked repository paths', exact: true })).toHaveCount(0,
    'opting in alone does not enumerate paths')
  await writeFile(join(repository, untrackedOcrPath), untrackedOcrBytes, { mode: 0o600 })
  await untrackedBrowser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  const untrackedListing = untrackedBrowser.getByRole('list', { name: 'Untracked repository paths', exact: true })
  await expect(untrackedListing).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(untrackedListing).toContainText('.ordinary-note.md')
  await expect(untrackedListing).toContainText('untracked-document.docx')
  await expect(untrackedListing).toContainText('untracked-secret.md')
  await expect(untrackedListing).not.toContainText('ignored-secret.md')
  await expect(untrackedBrowser).not.toContainText('untracked-dotfile-reviewed-v1')
  await expect(untrackedBrowser).not.toContainText('must-never-enter-model')
  await expect(untrackedBrowser.locator('[data-local-git-untracked-file-preview]')).toHaveCount(0,
    'explicit path enumeration remains metadata-only')
  assert.deepEqual(await readWorkspace(run.page, untrackedSession.id), untrackedBefore,
    'opt-in path listing still does not persist content')
  assert.equal(endpoint.requests.length, untrackedModelBefore, 'path listing makes no model request')

  const dotfilePath = '.ordinary-note.md'
  await untrackedListing.getByRole('button', { name: `${dotfilePath} Untracked file`, exact: true }).click()
  const dotfilePreview = untrackedBrowser.getByRole('region', { name: `Preview of ${dotfilePath}`, exact: true })
  await expect(dotfilePreview).toHaveText('untracked-dotfile-reviewed-v1\n', { timeout: TIMEOUT_MS })
  assert.deepEqual(await readWorkspace(run.page, untrackedSession.id), untrackedBefore,
    'untracked text preview is transient')
  assert.equal(endpoint.requests.length, untrackedModelBefore, 'untracked text preview makes no model request')
  await writeFile(join(repository, dotfilePath), 'untracked-dotfile-replaced-after-review-v2\n')
  await untrackedBrowser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(untrackedPicker).toContainText('1 added', { timeout: TIMEOUT_MS })

  const documentPath = 'untracked-document.docx'
  await untrackedListing.getByRole('button', { name: `${documentPath} Untracked file`, exact: true }).click()
  const documentPreview = untrackedBrowser.getByRole('region', { name: `Preview of ${documentPath}`, exact: true })
  const documentText = 'untracked-document-reviewed-v1 · café 世界 😀'
  await expect(documentPreview).toHaveText(documentText, { timeout: TIMEOUT_MS })
  await expect(untrackedBrowser.locator('[data-local-document-preview="docx"]')).toContainText('Word body text')
  assert.deepEqual(await readWorkspace(run.page, untrackedSession.id).then(workspace => workspace.attachments.map(({ label }) => label)),
    [dotfilePath], 'document preview remains separate from Attach')
  assert.equal(endpoint.requests.length, untrackedModelBefore, 'untracked document worker preview makes no model request')
  await writeFile(join(repository, documentPath), docxFixture({ paragraphs: ['untracked-document-replaced-after-review-v2'] }))
  await untrackedBrowser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(untrackedPicker).toContainText('2 added', { timeout: TIMEOUT_MS })
  const untrackedImageReceipt = await smokeLocalImageBrowse({
    run, root: repository, path: untrackedImage.name, kind: 'ico', source: 'git-untracked',
    browser: untrackedBrowser, picker: untrackedPicker, sessionId: untrackedSession.id, endpoint,
    listKind: 'Untracked file', previewSelector: '[data-local-git-untracked-file-preview]',
    pickerAddedCount: 3, verifySourceMetadata: () => assertIndexUnchanged(repository, untrackedIndexBefore),
  })
  const untrackedSaved = await readWorkspace(run.page, untrackedSession.id)
  assert.deepEqual(untrackedSaved.attachments.filter(item => item.kind === 'file').map(({ label, kind, source, previewText, documentImport }) => ({
    label, kind, source, previewText, documentImport,
  })), [
    { label: dotfilePath, kind: 'file', source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      previewText: 'untracked-dotfile-reviewed-v1\n', documentImport: undefined },
    { label: documentPath, kind: 'file', source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      previewText: documentText, documentImport: { format: 'docx', status: 'ready' } },
  ], 'Attach saves exactly the reviewed text and real worker outcome, not later source changes')
  assert.ok(untrackedSaved.attachments.find(item => item.label === untrackedImage.name)?.image,
    'the explicit untracked image Attach saves a normalized image reference')
  assert.equal(JSON.stringify(untrackedSaved).includes(fixtureRoot), false, 'untracked copies do not persist native paths')
  assert.equal(JSON.stringify(untrackedSaved).includes('untracked-dotfile-replaced-after-review-v2'), false)
  assert.equal(JSON.stringify(untrackedSaved).includes('untracked-document-replaced-after-review-v2'), false)
  assert.equal(endpoint.requests.length, untrackedModelBefore + 1, 'only explicit Send calls a model after the untracked image preview')
  await assertIndexUnchanged(repository, untrackedIndexBefore)
  await assertModelFiles(endpoint, [
    [dotfilePath, 'ready', 'untracked-dotfile-reviewed-v1\n'],
    [documentPath, 'ready', documentText],
    { name: untrackedImage.name, status: 'image-ready', image_index: 1, width: 64, height: 32 },
  ])
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(untrackedSession.id)}`)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const untrackedOcrPicker = run.page.getByRole('dialog', { name: 'Add context', exact: true })
  await untrackedOcrPicker.getByRole('button', { name: /^Repository/ }).click()
  await untrackedOcrPicker.getByRole('button', { name: `Browse files in ${repositoryName}`, exact: true }).click()
  const untrackedOcrToggle = untrackedOcrPicker.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
  await untrackedOcrToggle.click()
  await expect(untrackedOcrToggle).toHaveAttribute('aria-checked', 'true')
  const untrackedOcrBrowser = untrackedOcrPicker.locator('[data-local-git-untracked-browser]')
  await untrackedOcrBrowser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  await expect(untrackedOcrBrowser.getByRole('list', { name: 'Untracked repository paths', exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
  const untrackedOcrReceipt = await smokeLocalImageOcrDocument({
    run, root: repository, path: untrackedOcrPath, bytes: untrackedOcrBytes, source: 'git-untracked',
    browser: untrackedOcrBrowser, endpoint, listKind: 'Untracked file',
    previewSelector: '[data-local-git-untracked-file-preview]',
    verifySourceMetadata: () => assertIndexUnchanged(repository, untrackedIndexBefore),
  })
  assert.equal(JSON.stringify(endpoint.requests.at(-1)).includes('must-never-enter-model'), false,
    'unselected untracked and ignored bodies never reach the model')
  assert.equal(JSON.stringify(endpoint.requests.at(-1)).includes('replaced-after-review'), false,
    'source changes after preview never replace the reviewed model input')
  const untrackedSourcePaths = [join(repository, dotfilePath), join(repository, documentPath),
    untrackedOcrReceipt.sourcePath, untrackedImageReceipt.sourcePath]
  for (const [index, path] of untrackedSourcePaths.entries()) {
    await rename(path, join(fixtureRoot, `untracked-source-held-${index}`))
  }
  await assertIndexUnchanged(repository, untrackedIndexBefore)

  const documentBrowseReceipt = await smokeLocalDocumentBrowse({
    run, root: repository, source: 'git', name: repositoryName, providerId, endpoint,
    prepareFiles: async paths => {
      git(gitExecutable, repository, 'add', '--', ...paths)
      const documentIndex = await indexState(repository)
      return () => assertIndexUnchanged(repository, documentIndex)
    },
  })
  await rename(documentBrowseReceipt.sourceDirectory, join(fixtureRoot, 'git-browse-documents-held'))

  // These generated files must stay outside the index. Reuse the same real
  // PDF/Office workflow through separate untracked consent and selection.
  const untrackedDocumentIndex = await indexState(repository)
  const untrackedDocumentReceipt = await smokeLocalDocumentBrowse({
    run, root: repository, source: 'git-untracked', name: repositoryName, providerId, endpoint,
    prepareFiles: async () => {
      await assertIndexUnchanged(repository, untrackedDocumentIndex)
      return () => assertIndexUnchanged(repository, untrackedDocumentIndex)
    },
  })
  assert.notEqual(untrackedDocumentReceipt.sessionId, documentBrowseReceipt.sessionId)
  assert.notEqual(untrackedDocumentReceipt.sourceDirectory, documentBrowseReceipt.sourceDirectory)
  const authoredIds = [documentBrowseReceipt, untrackedDocumentReceipt]
    .flatMap(receipt => [receipt.createdDocument, ...receipt.createdStructured].map(artifact => artifact.id))
  assert.equal(new Set(authoredIds).size, 6, 'tracked and untracked runs created six independent authored artifacts')
  await rename(untrackedDocumentReceipt.sourceDirectory, join(fixtureRoot, 'git-untracked-documents-held'))
  await assertIndexUnchanged(repository, untrackedDocumentIndex)

  const heldTrackedOcr = join(fixtureRoot, 'tracked-ocr-source-held.png')
  await rename(trackedOcrReceipt.sourcePath, heldTrackedOcr)

  // A full packaged-process relaunch proves the remembered native grant and
  // durable saved snapshot are separate: reopening access does not auto-attach.
  await run.app.close()
  run = await relaunch(executable, userDataPath)
  for (const path of untrackedSourcePaths) await assert.rejects(stat(path), { code: 'ENOENT' }, 'untracked source is absent after full relaunch')
  assert.deepEqual(await readWorkspace(run.page, untrackedSession.id), untrackedSaved,
    'saved untracked copies survive packaged relaunch without their source files')
  await verifyLocalImageBrowseRelaunch(run, trackedImageReceipt)
  await verifyLocalImageBrowseRelaunch(run, untrackedImageReceipt)
  await verifyLocalImageOcrDocumentRelaunch(run, trackedOcrReceipt)
  await verifyLocalImageOcrDocumentRelaunch(run, untrackedOcrReceipt)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(untrackedSession.id)}`)
  await send(run.page, 'Read the reviewed untracked saved copies after relaunch.', 'Received 1 supplied image(s).', 1)
  await assertModelFiles(endpoint, [
    [dotfilePath, 'ready', 'untracked-dotfile-reviewed-v1\n'],
    [documentPath, 'ready', documentText],
    { name: untrackedImage.name, status: 'image-ready', image_index: 1, width: 64, height: 32 },
  ])
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(session.id)}`)
  connections = await nativeGitConnections(run.page)
  assert.deepEqual(connections.map(({ name, remembered }) => [name, remembered]), [[repositoryName, true]],
    'only the explicitly remembered Git connection survives a real app relaunch')
  assert.equal(connections[0].id, connectionId, 'relaunch restores the original opaque Git connection id')
  const reopenedWorkspace = await readWorkspace(run.page, session.id)
  assert.ok(gitFolder(reopenedWorkspace, connectionId)?.gitSnapshot, 'the saved Git copy survives relaunch')
  assert.deepEqual(await readWorkspace(run.page, browseSession.id), savedBrowse,
    'the exact separately attached file survives native relaunch without rereading its source')
  await verifyLocalDocumentBrowseRelaunch(run, documentBrowseReceipt, endpoint)
  await verifyLocalDocumentBrowseRelaunch(run, untrackedDocumentReceipt, endpoint)
  await assertIndexUnchanged(repository, untrackedDocumentIndex)
  await run.page.goto(run.origin + '/contexts/' + encodeURIComponent(connectionId))
  const reopenedReviewPanel = run.page.locator('[data-local-git-review]')
  await expect(reopenedReviewPanel).toBeVisible()
  await expect(reopenedReviewPanel.locator('[data-local-git-review-result]')).toHaveCount(0,
    'a prior transient review does not return automatically after relaunch')
  await expect(run.page.locator('[data-local-git-browser-listing]')).toHaveCount(0)
  await expect(run.page.locator('[data-local-git-file-preview]')).toHaveCount(0)
  await run.page.goto(run.origin + '/s/' + encodeURIComponent(session.id))
  await send(run.page, 'Read the Git snapshot after relaunch.', 'captured-dotfile-v1', 3)
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
  ])

  // Missing-source refresh refuses without touching the last saved copy.
  const beforeMissingSource = await readWorkspace(run.page, session.id)
  await rename(repository, heldRepository)
  try {
    const refreshedGroup = run.page.locator(`[data-workspace-folder="ui-host::${connectionId}"]:visible`)
    await refreshedGroup.getByRole('button', { name: /^Refresh/ }).click()
    await expect(run.page.getByText('Couldn’t confirm the context update. The repository is unavailable or has changed. Your saved snapshots have not been changed.', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: TIMEOUT_MS })
    assert.deepEqual(await readWorkspace(run.page, session.id), beforeMissingSource,
      'missing-source refusal leaves the exact saved Git workspace and capture receipt unchanged')
    await run.page.getByRole('button', { name: 'Use saved state', exact: true }).filter({ visible: true }).first().click()
    await send(run.page, 'Read the saved Git snapshot without its source.', 'captured-dotfile-v1', 4)
    await assertModelFiles(endpoint, [
      ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
      ['.gitignore', 'ready', 'ignored-secret.md\n'],
      ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
    ])
  } finally {
    await rename(heldRepository, repository)
  }

  // Disconnect is a real renderer-to-preload-to-main action. It revokes later
  // reads but neither deletes the conversation's saved copy nor its model input.
  await run.page.goto(run.origin + '/contexts/' + encodeURIComponent(connectionId))
  const disconnectReviewPanel = run.page.locator('[data-local-git-review]')
  await expect(disconnectReviewPanel).toBeVisible()
  await expect(disconnectReviewPanel.locator('[data-local-git-review-result]')).toHaveCount(0,
    'the relaunch left no automatic transient review')
  await disconnectReviewPanel.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(disconnectReviewPanel.locator('[data-local-git-review-result]')).toBeVisible({ timeout: TIMEOUT_MS })
  const beforeDisconnect = await readWorkspace(run.page, session.id)
  await run.page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(run.page.locator('[data-local-git-review]')).toHaveCount(0,
    'disconnect removes the device-only review result from the repository page')
  await expect(run.page.getByText(/This repository connection is not available to this account on this device/)).toBeVisible()
  const afterDisconnectConnections = await nativeGitConnections(run.page)
  assert.deepEqual(afterDisconnectConnections, [], 'Disconnect revokes the remembered native connection')
  assert.deepEqual(await readWorkspace(run.page, session.id), beforeDisconnect,
    'disconnect preserves the conversation saved copy')
  await run.page.goto(run.origin + '/s/' + encodeURIComponent(session.id))
  const beforeRevokedRefresh = await readWorkspace(run.page, session.id)
  const disconnectedGroup = run.page.locator(`[data-workspace-folder="ui-host::${connectionId}"]:visible`)
  await disconnectedGroup.getByRole('button', { name: /^Refresh/ }).click()
  await expect(run.page.getByText('Couldn’t confirm the context update. The repository is unavailable or has changed. Your saved snapshots have not been changed.', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: TIMEOUT_MS })
  assert.deepEqual(await readWorkspace(run.page, session.id), beforeRevokedRefresh,
    'revoked Refresh cannot delete or rewrite the saved conversation copy')
  await run.page.getByRole('button', { name: 'Use saved state', exact: true }).filter({ visible: true }).first().click()
  await send(run.page, 'Read the saved Git snapshot after disconnect.', 'captured-dotfile-v1', 5)
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
  ])
  assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
  // The explicit one-file workflow remains usable beyond whole-review limits.
  // This fixture grows only after the smaller-repository acceptance above.
  await mkdir(join(repository, 'large-index'), { recursive: true })
  for (let index = 0; index < 501; index += 1) {
    await writeFile(join(repository, 'large-index', `file-${index}.md`), 'unselected large-repository body\n')
  }
  git(gitExecutable, repository, 'add', '--', 'large-index')
  const selectedIndexBefore = await indexState(repository)
  const selectedSession = await run.page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error('Could not create the selected-comparison conversation.')
    return response.json()
  }, providerId)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(selectedSession.id)}`)
  await configureRepositoryDialog(run.app, repository)
  await run.page.getByRole('button', { name: 'Add context' }).click()
  const selectedPicker = run.page.getByRole('dialog', { name: 'Add context' })
  await selectedPicker.getByRole('button', { name: /^Repository/ }).click()
  await selectedPicker.getByRole('checkbox', { name: /Remember this connection/ }).check()
  await selectedPicker.getByRole('button', { name: /Choose a repository from this computer/ }).click()
  await expect(selectedPicker.getByRole('button', { name: `Review changes in ${repositoryName}`, exact: true })).toBeVisible()
  const selectedConnections = await nativeGitConnections(run.page)
  assert.equal(selectedConnections.length, 1)
  const selectedConnectionId = selectedConnections[0].id
  await selectedPicker.getByRole('button', { name: `Review changes in ${repositoryName}`, exact: true }).click()
  const largeReview = selectedPicker.locator('[data-local-git-review]')
  await largeReview.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(largeReview.getByRole('alert')).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(largeReview.locator('[data-local-git-review-result]')).toHaveCount(0)
  const selectedPanel = largeReview.locator('[data-local-git-file-comparison]')
  const selectedResult = selectedPanel.locator('[data-local-git-file-comparison-result]')
  const selectedModelBefore = endpoint.requests.length
  const selectedWorkspaceBefore = await readWorkspace(run.page, selectedSession.id)
  await selectedPanel.getByLabel('Repository-relative path', { exact: true }).fill(exactOldPath)
  await selectedPanel.getByRole('button', { name: 'Compare file', exact: true }).click()
  await expect(selectedResult).toContainText('Deleted', { timeout: TIMEOUT_MS })
  await selectedResult.getByLabel('Review view').selectOption('full')
  assert.equal(await selectedResult.getByLabel('HEAD · Regular file').textContent(), exactText)
  await expect(selectedResult.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await selectedPanel.getByRole('combobox', { name: 'Comparison direction', exact: true }).selectOption('unstaged')
  await expect(selectedResult).toHaveCount(0, 'editing the direction retires the captured result without reading')
  await selectedPanel.getByRole('button', { name: 'Compare file', exact: true }).click()
  await expect(selectedResult).toContainText('not present in the index', { timeout: TIMEOUT_MS })
  await expect(selectedResult.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
  await selectedPanel.getByLabel('Repository-relative path', { exact: true }).fill('src/nested.md')
  await selectedPanel.getByRole('button', { name: 'Compare file', exact: true }).click()
  await expect(selectedResult).toContainText('Modified', { timeout: TIMEOUT_MS })
  const selectedCopy = selectedResult.locator('[data-git-file-comparison-copy]')
  await selectedCopy.getByText('Saved comparison contents', { exact: true }).click()
  const selectedText = await selectedCopy.locator('[data-git-file-comparison-copy-text]').textContent()
  const selectedCopyValue = JSON.parse(selectedText)
  assert.deepEqual(selectedCopyValue, {
    version: 1, kind: 'git-file-comparison-copy', repositoryName,
    capturedAt: selectedCopyValue.capturedAt,
    head: { ref: 'refs/heads/main', oid: git(gitExecutable, repository, 'rev-parse', 'HEAD').trim() },
    comparison: 'unstaged', path: 'src/nested.md', change: 'modified',
    before: { kind: 'text', text: 'captured-nested-index-v1\n', mode: '100644' },
    after: { kind: 'text', text: 'comparison-source-changed-after-preview-v5\n', mode: '100644' },
  }, 'single-file comparison captures exact sides despite the refused whole review')
  assert.equal(JSON.stringify(selectedCopyValue, null, 2), selectedText)
  assert.equal(new Date(selectedCopyValue.capturedAt).toISOString(), selectedCopyValue.capturedAt)
  assert.deepEqual(await readWorkspace(run.page, selectedSession.id), selectedWorkspaceBefore)
  assert.equal(endpoint.requests.length, selectedModelBefore)
  await writeFile(join(repository, 'src', 'nested.md'), 'selected-source-changed-after-read-v6\n')
  await selectedCopy.getByRole('button', { name: 'Attach this comparison', exact: true }).click()
  await expect(selectedPicker).toContainText('1 added', { timeout: TIMEOUT_MS })
  const selectedSaved = await readWorkspace(run.page, selectedSession.id)
  assert.deepEqual(selectedSaved.attachments, [{
    id: selectedSaved.attachments[0].id, label: comparisonName, kind: 'file',
    source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' }, previewText: selectedText,
  }], 'Attach saves the exact selected comparison without a native reread')
  assert.equal(endpoint.requests.length, selectedModelBefore)
  await assertIndexUnchanged(repository, selectedIndexBefore)
  await run.page.screenshot({ path: join(fixtureRoot, 'local-git-file-comparison.png') })
  await selectedPicker.getByRole('button', { name: 'Done', exact: true }).click()
  await send(run.page, 'Read the selected-file Git comparison.', 'Read supplied attachment:', 0)
  assert.equal(endpoint.requests.length, selectedModelBefore + 1)
  await assertModelFiles(endpoint, [[comparisonName, 'ready', selectedText]])

  const selectedSource = join(repository, 'src', 'nested.md')
  await rename(selectedSource, join(fixtureRoot, 'selected-comparison-source-held.md'))
  await run.app.close()
  run = await relaunch(executable, userDataPath)
  await assert.rejects(stat(selectedSource), { code: 'ENOENT' })
  assert.deepEqual(await readWorkspace(run.page, selectedSession.id), selectedSaved,
    'the exact selected comparison survives full relaunch without its source')
  await run.page.goto(`${run.origin}/contexts/${encodeURIComponent(selectedConnectionId)}`)
  await expect(run.page.locator('[data-local-git-file-comparison]')).toBeVisible()
  await expect(run.page.locator('[data-local-git-file-comparison-result]')).toHaveCount(0)
  await expect(run.page.getByLabel('Repository-relative path', { exact: true })).toHaveValue('')
  await expect(run.page.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
  await run.page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(run.page.locator('[data-local-git-file-comparison]')).toHaveCount(0)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(selectedSession.id)}`)
  await send(run.page, 'Read the selected-file comparison without its source or connection.', 'Read supplied attachment:', 1)
  await assertModelFiles(endpoint, [[comparisonName, 'ready', selectedText]])
  await assertIndexUnchanged(repository, selectedIndexBefore)
  console.log('[desktop-local-git-smoke] native dialog result fixture only · bundled Git + packaged reader/IPC/preload/renderer · tracked working edits and exclusions · explicit transient staged/unstaged review · optional identical/edited possible-rename grouping with raw opt-out · index/sharedindex names+bytes+mtime unchanged · remembered relaunch · saved-only Attach/Refresh/review/model input · missing-source recovery · disconnect clears review, retains copy and revokes Refresh')
  return run
}
