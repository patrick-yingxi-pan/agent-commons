import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect } from '@playwright/test'
import { bundledGitDirectory } from './bundledGit.mjs'
import { localGitCommandEnvironment } from './localGitReader.mjs'

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
  for (const expected of before) {
    assert.deepEqual(await readFile(join(repository, '.git', expected.name)), expected.bytes, `${expected.name} bytes remain unchanged`)
    assert.equal((await stat(join(repository, '.git', expected.name), { bigint: true })).mtimeNs, expected.mtimeNs, `${expected.name} mtime remains unchanged`)
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

async function send(page, text, expectedReply) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  const replies = page.locator('[data-turn]').filter({ hasText: expectedReply })
  const previous = await replies.count()
  await composer.fill(text)
  await composer.press('Enter')
  await expect(replies).toHaveCount(previous + 1, { timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
}

async function assertModelFiles(endpoint, expected) {
  const actual = endpoint.documents.at(-1)?.attached_files ?? []
  assert.deepEqual(actual.map(file => [file.name.split('/').at(-1), file.status, file.text]), expected)
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
  await mkdir(join(repository, '.config'), { recursive: true })
  await mkdir(join(repository, 'src'), { recursive: true })
  await writeFile(join(repository, '.gitignore'), 'ignored-secret.md\n')
  await writeFile(join(repository, '.config', 'tracked.md'), 'captured-dotfile-v1\n')
  await writeFile(join(repository, 'src', 'nested.md'), 'captured-nested-v1\n')
  await writeFile(join(repository, 'ignored-secret.md'), 'must-never-enter-model ignored content')
  await writeFile(join(repository, 'untracked-secret.md'), 'must-never-enter-model untracked content')
  git(gitExecutable, repository, 'init', '--template=', '--initial-branch=main', '.')
  git(gitExecutable, repository, 'add', '--', '.gitignore', '.config/tracked.md', 'src/nested.md')
  git(gitExecutable, repository, 'update-index', '--split-index')
  await writeFile(join(repository, 'src', 'nested.md'), 'captured-nested-v1-edited-after-stage\n')
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
  assert.equal(attached.gitSnapshot.files.find(file => file.path === 'src/nested.md').snapshot.text, 'captured-nested-v1-edited-after-stage\n',
    'capture reads current tracked working bytes, including edits made after staging')
  await assertIndexUnchanged(repository, indexBeforeAttach)

  // Change the source after Attach but before sending: the first turn must use
  // the saved capture, not implicitly reread the repository.
  await writeFile(join(repository, 'src', 'nested.md'), 'captured-nested-v2-before-refresh\n')
  await send(run.page, 'Read the attached Git snapshot.', 'captured-dotfile-v1')
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v1-edited-after-stage\n'],
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
  await writeFile(join(repository, 'src', 'nested.md'), 'not-saved-until-next-refresh\n')
  await send(run.page, 'Read the refreshed Git snapshot.', 'captured-dotfile-v1')
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
  ])

  // A full packaged-process relaunch proves the remembered native grant and
  // durable saved snapshot are separate: reopening access does not auto-attach.
  await run.app.close()
  run = await relaunch(executable, userDataPath)
  await run.page.goto(`${run.origin}/s/${encodeURIComponent(session.id)}`)
  connections = await nativeGitConnections(run.page)
  assert.deepEqual(connections.map(({ name, remembered }) => [name, remembered]), [[repositoryName, true]],
    'only the explicitly remembered Git connection survives a real app relaunch')
  assert.equal(connections[0].id, connectionId, 'relaunch restores the original opaque Git connection id')
  const reopenedWorkspace = await readWorkspace(run.page, session.id)
  assert.ok(gitFolder(reopenedWorkspace, connectionId)?.gitSnapshot, 'the saved Git copy survives relaunch')
  await send(run.page, 'Read the Git snapshot after relaunch.', 'captured-dotfile-v1')
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
    await send(run.page, 'Read the saved Git snapshot without its source.', 'captured-dotfile-v1')
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
  const identity = await run.page.evaluate(async () => {
    const response = await fetch('/api/v1/me')
    if (!response.ok) throw new Error('The local Git identity precondition failed.')
    const value = await response.json()
    return { namespace: value.tenant.id, userId: value.user.id }
  })
  await run.page.evaluate(async ({ id, source }) => {
    await window.agentCommonsDesktop.context.localGit.disconnect(id, source)
  }, { id: connectionId, source: identity })
  const afterDisconnectConnections = await nativeGitConnections(run.page)
  assert.deepEqual(afterDisconnectConnections, [], 'Disconnect revokes the remembered native connection')
  const beforeRevokedRefresh = await readWorkspace(run.page, session.id)
  const disconnectedGroup = run.page.locator(`[data-workspace-folder="ui-host::${connectionId}"]:visible`)
  await disconnectedGroup.getByRole('button', { name: /^Refresh/ }).click()
  await expect(run.page.getByText('Couldn’t confirm the context update. The repository is unavailable or has changed. Your saved snapshots have not been changed.', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: TIMEOUT_MS })
  assert.deepEqual(await readWorkspace(run.page, session.id), beforeRevokedRefresh,
    'revoked Refresh cannot delete or rewrite the saved conversation copy')
  await run.page.getByRole('button', { name: 'Use saved state', exact: true }).filter({ visible: true }).first().click()
  await send(run.page, 'Read the saved Git snapshot after disconnect.', 'captured-dotfile-v1')
  await assertModelFiles(endpoint, [
    ['tracked.md', 'ready', 'captured-dotfile-v1\n'],
    ['.gitignore', 'ready', 'ignored-secret.md\n'],
    ['nested.md', 'ready', 'captured-nested-v2-before-refresh\n'],
  ])
  assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
  console.log('[desktop-local-git-smoke] native dialog result fixture only · bundled Git + packaged reader/IPC/preload/renderer · tracked working edits and exclusions · index/sharedindex bytes+mtime unchanged · remembered relaunch · saved-only Attach/Refresh/model input · missing-source recovery · disconnect retains copy and revokes Refresh')
  return run
}
