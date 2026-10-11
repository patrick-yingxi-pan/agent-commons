import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGitFileHelper } from './gitFileBuild.mjs'
import { listLocalFolderTree } from './gitFileRead.mjs'
import { inspectLocalFolderRoot } from './localFolderReader.mjs'

const version = '1:2:33188:3:4:5:6:7'
const directoryVersion = '1:3:16877:0:4:5:6:7'
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

test('folder enumeration protocol requires a closed bounded UTF-8 tree with real parents and unique visible paths', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-protocol-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = await inspectLocalFolderRoot(temporary)
  let index = 0
  async function helper(response: string) {
    const executable = join(temporary, `fixture-${index++}`)
    await writeFile(executable, `#!/bin/sh\nif [ "$#" = 4 ] && [ "$1" = '--list-folder-tree' ] && [ "$2" = ${quote(root.path)} ] && [ "$3" = ${quote(root.identity.dev)} ] && [ "$4" = ${quote(root.identity.ino)} ]; then printf '%s' ${quote(response)}; else exit 64; fi\n`)
    await chmod(executable, 0o755)
    return executable
  }
  const good = `D 2 3 1 ${directoryVersion}\nF 3 ${version}\tdir/file.md\nD 0 ${directoryVersion}\tdir\n`
  assert.deepEqual(await listLocalFolderTree(root, { executable: await helper(good) }), {
    rootVersion: directoryVersion, visited: 3, directoryCount: 1,
    entries: [
      { kind: 'D', name: 'dir', sizeBytes: 0, version: directoryVersion },
      { kind: 'F', name: 'dir/file.md', sizeBytes: 3, version },
    ],
  })
  for (const response of [
    `D 0 501 0 ${version}\n`, `D 0 0 65 ${version}\n`,
    `D 1 1 0 ${version}\nF 3 ${version}\tmissing/file.md\n`,
    `D 2 2 0 ${version}\nF 3 ${version}\ta.md\nF 3 ${version}\ta.md\n`,
    `D 1 1 0 ${version}\nF 3 ${version}\t../outside.md\n`,
    `D 1 1 0 ${version}\nF 3 ${version}\t.hidden.md\n`,
    `D 1 1 0 ${version}\nF 3 ${version}\t/a.md\n`,
    `D 1 1 0 ${version}\nF 9007199254740992 ${version}\ta.md\n`,
    `D 0 0 0 ${version}\nextra\n`, `D 00 0 0 ${version}\n`, 'R\n', 'C\n',
  ]) await assert.rejects(listLocalFolderTree(root, { executable: await helper(response) }), /invalid tree|changed/)
})

test('native enumeration refuses directory rebinding and changed nested files before publishing metadata', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-enumeration-race-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = buildGitFileHelper({ outputPath: join(temporary, 'helper'), testHooks: true })
  for (const mutation of ['directory-link', 'file-rewrite', 'empty-directory-rebind', 'before-descent-link']) {
    const rootPath = join(temporary, mutation)
    await mkdir(join(rootPath, 'nested'), { recursive: true })
    await mkdir(join(rootPath, 'empty'))
    await writeFile(join(rootPath, 'nested', 'file.md'), 'original')
    const root = await inspectLocalFolderRoot(rootPath)
    const ready = join(temporary, `${mutation}-ready`)
    const release = join(temporary, `${mutation}-release`)
    const child = spawn(executable, ['--list-folder-tree', root.path, root.identity.dev, root.identity.ino], {
      cwd: '/', stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', AGENT_COMMONS_GIT_FILE_TEST_READY: ready, AGENT_COMMONS_GIT_FILE_TEST_RELEASE: release,
        ...(mutation === 'before-descent-link' ? { AGENT_COMMONS_FOLDER_TREE_TEST_DIRECTORY: 'nested' } : {}),
      },
    })
    t.after(async () => {
      await writeFile(release, 'release').catch(() => {})
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    })
    const output = new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      child.once('error', reject)
      child.once('close', (code, signal) => code === 0 && signal === null
        ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('helper failed')))
    })
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try { await lstat(ready); break } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await lstat(ready)
    if (mutation === 'directory-link' || mutation === 'before-descent-link') {
      await rename(join(rootPath, 'nested'), join(rootPath, 'parked'))
      await symlink(join(rootPath, 'parked'), join(rootPath, 'nested'))
    } else if (mutation === 'file-rewrite') await writeFile(join(rootPath, 'nested', 'file.md'), 'rewritten')
    else {
      await rename(join(rootPath, 'empty'), join(rootPath, 'parked-empty'))
      await mkdir(join(rootPath, 'empty'))
    }
    await writeFile(release, 'continue')
    assert.equal(await output, 'C\n', mutation)
  }
})
