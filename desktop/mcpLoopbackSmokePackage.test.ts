import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createMcpLoopbackSmokePackage } from './mcpLoopbackSmokePackage.mjs'

const require = createRequire(import.meta.url)
const { createPackageWithOptions, extractFile, getRawHeader } = require('@electron/asar')
const TEMP_PREFIX = 'agent-commons-mcp-loopback-'

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function header(archive) {
  return JSON.parse(getRawHeader(archive).headerString).files
}

function flatten(files, prefix = '') {
  const paths = []
  for (const [name, entry] of Object.entries(files)) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) paths.push(...flatten(entry.files, path))
    else if (!entry.link) paths.push(path)
  }
  return paths
}

async function fixtureApp(startupSource = 'export const options = { allowLoopback: false, }\n') {
  const root = await mkdtemp(join(tmpdir(), 'mcp-loopback-package-test-'))
  const app = join(root, 'Fixture.app')
  const contents = join(app, 'Contents')
  const resources = join(contents, 'Resources')
  const macOs = join(contents, 'MacOS')
  const asarSource = join(root, 'asar-source')
  await mkdir(resources, { recursive: true })
  await mkdir(macOs)
  await mkdir(join(asarSource, 'scripts'), { recursive: true })
  await mkdir(join(asarSource, 'native'), { recursive: true })
  await writeFile(join(macOs, 'Fixture'), Buffer.from('fake macOS executable bytes'))
  await chmod(join(macOs, 'Fixture'), 0o755)
  await writeFile(join(contents, 'Info.plist'), '<plist>fixture</plist>')
  await writeFile(join(asarSource, 'scripts', 'start.mjs'), startupSource)
  await writeFile(join(asarSource, 'scripts', 'unrelated.mjs'), 'export const unchanged = true\n')
  await writeFile(join(asarSource, 'native', 'helper.bin'), Buffer.from([0, 1, 2, 3, 255]))
  const asarPath = join(resources, 'app.asar')
  await createPackageWithOptions(asarSource, asarPath, { unpack: '**/helper.bin' })
  return { root, app, executable: join(macOs, 'Fixture'), asarPath }
}

async function closeFixture(fixture) {
  await rm(fixture.root, { recursive: true, force: true })
}

test('creates a private app copy with only scripts/start.mjs changed and source archive intact', async () => {
  const fixture = await fixtureApp()
  const sourceArchiveBytes = await readFile(fixture.asarPath)
  const sourceHash = hash(sourceArchiveBytes)
  const sourceExecutableBytes = await readFile(fixture.executable)
  const sourceInfoBytes = await readFile(join(fixture.app, 'Contents', 'Info.plist'))
  let copy
  try {
    copy = await createMcpLoopbackSmokePackage(fixture.executable)
    assert.notEqual(copy.executable, fixture.executable)
    assert.equal(copy.sourceAsarSha256, sourceHash)
    assert.equal(copy.fixtureAsarSha256, hash(await readFile(join(dirname(dirname(copy.executable)), 'Resources', 'app.asar'))))
    assert.deepEqual(await readFile(fixture.asarPath), sourceArchiveBytes)
    assert.deepEqual(await readFile(copy.executable), sourceExecutableBytes)
    assert.deepEqual(await readFile(join(dirname(dirname(copy.executable)), 'Info.plist')), sourceInfoBytes)

    const fixtureArchive = join(dirname(dirname(copy.executable)), 'Resources', 'app.asar')
    const fixtureFiles = flatten(header(fixtureArchive))
    const sourceFiles = flatten(header(fixture.asarPath))
    assert.deepEqual(fixtureFiles.slice().sort(), sourceFiles.slice().sort(), 'fixture retains exactly the source ASAR file set')
    const changed = []
    for (const path of sourceFiles) {
      assert.ok(fixtureFiles.includes(path), `fixture retains ${path}`)
      const sourceBytes = extractFile(fixture.asarPath, path)
      const copyBytes = extractFile(fixtureArchive, path)
      if (!sourceBytes.equals(copyBytes)) changed.push(path)
    }
    assert.deepEqual(changed, ['scripts/start.mjs'])
    assert.match(extractFile(fixtureArchive, 'scripts/start.mjs').toString(), /allowLoopback: true,/)
    assert.doesNotMatch(extractFile(fixtureArchive, 'scripts/start.mjs').toString(), /allowLoopback: false,/)
    assert.equal(header(fixtureArchive).native.files['helper.bin'].unpacked, true)
    assert.deepEqual(extractFile(fixtureArchive, 'native/helper.bin'), Buffer.from([0, 1, 2, 3, 255]))
  } finally {
    if (copy) await copy.close()
    await closeFixture(fixture)
  }
})

test('refuses missing, ambiguous, or already changed startup switches before creating a fixture', async () => {
  const cases = [
    ['export const options = {}\n', /Expected exactly one .*found 0/],
    ['allowLoopback: false, allowLoopback: false,\n', /Expected exactly one .*found 2/],
    ['export const options = { allowLoopback: true, }\n', /Expected exactly one .*found 0/],
  ]
  for (const [source, expected] of cases) {
    const fixture = await fixtureApp(source)
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith(TEMP_PREFIX)).sort()
    try {
      await assert.rejects(createMcpLoopbackSmokePackage(fixture.executable), expected)
      const after = (await readdir(tmpdir())).filter((name) => name.startsWith(TEMP_PREFIX)).sort()
      assert.deepEqual(after, before, 'refusal happens before generating a usable fixture root')
    } finally {
      await closeFixture(fixture)
    }
  }
})

test('close removes only its generated copy and reports source ASAR mutation', async () => {
  const fixture = await fixtureApp()
  const original = await readFile(fixture.asarPath)
  let copy
  try {
    copy = await createMcpLoopbackSmokePackage(fixture.executable)
    const copiedApp = dirname(dirname(dirname(copy.executable)))
    const generatedRoot = dirname(copiedApp)
    const changedSource = Buffer.concat([original, Buffer.from('test-only source mutation')])
    await writeFile(fixture.asarPath, changedSource)

    await assert.rejects(copy.close(), /Source ASAR changed during MCP loopback smoke/)
    await assert.rejects(readFile(copy.executable), { code: 'ENOENT' })
    await assert.rejects(lstat(generatedRoot), { code: 'ENOENT' })
    assert.deepEqual(await readFile(fixture.asarPath), changedSource)
    assert.deepEqual(await readFile(fixture.executable), Buffer.from('fake macOS executable bytes'))
    assert.ok(generatedRoot.startsWith(join(await realpath(tmpdir()), TEMP_PREFIX)))
  } finally {
    if (copy) {
      await writeFile(fixture.asarPath, original)
      // close() is idempotent after its cleanup path has already run.
      await copy.close().catch(() => {})
    }
    await closeFixture(fixture)
  }
})
