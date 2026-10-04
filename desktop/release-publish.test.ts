import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants as fsConstants, existsSync } from 'node:fs'
import { copyFile, link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishImmutableRelease, publishImmutableReleaseSet } from './release-publish.mjs'

const stagingPrefix = '.agent-commons-release-publish-'

async function assertNoStagingDirectories(parent: string) {
  assert.deepEqual((await readdir(parent)).filter((name) => name.startsWith(stagingPrefix)), [])
}

test('single-release publication stages partial copy failures privately and removes exact temporary data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-publish-test-'))
  try {
    const stagedArchive = join(directory, 'source.zip')
    const stagedReceipt = join(directory, 'source.release.json')
    const stagedChecksum = join(directory, 'source.sha256')
    const archive = join(directory, 'release.zip')
    const receipt = join(directory, 'release.json')
    const checksum = join(directory, 'release.sha256')
    await writeFile(stagedArchive, 'verified archive')
    await writeFile(stagedReceipt, 'verified receipt')
    await writeFile(stagedChecksum, 'verified checksum')

    const finalPaths = new Set([archive, receipt, checksum])
    let copies = 0
    await assert.rejects(publishImmutableRelease({
      stagedArchive,
      archivePath: archive,
      auxiliaryArtifacts: [
        { stagedPath: stagedReceipt, destinationPath: receipt },
        { stagedPath: stagedChecksum, destinationPath: checksum },
      ],
      async copy(source, destination, flags) {
        copies += 1
        for (const finalPath of finalPaths) assert.equal(existsSync(finalPath), false, 'final destinations stay hidden while copying')
        assert.notEqual(destination, archive)
        assert.equal(flags, fsConstants.COPYFILE_EXCL)
        if (copies === 3) {
          await writeFile(destination, 'partial archive bytes')
          throw new Error('simulated partial archive copy failure')
        }
        await copyFile(source, destination, flags)
      },
    }), /simulated partial archive copy failure/)

    assert.equal(copies, 3)
    for (const finalPath of finalPaths) assert.equal(existsSync(finalPath), false)
    await assertNoStagingDirectories(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release-set completion copy failure never exposes outputs and preserves a pre-existing collision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-set-publish-test-'))
  try {
    const sources = ['arm.zip', 'intel.zip', 'arm.update.json', 'intel.update.json', 'release.json']
    const outputs = ['arm.zip', 'intel.zip', 'arm.update.json', 'intel.update.json', 'release.json']
    const staged = sources.map((name) => join(directory, `staged-${name}`))
    const destinations = outputs.map((name) => join(directory, name))
    for (const [index, path] of staged.entries()) await writeFile(path, `source-${index}`)

    const outputSet = new Set(destinations)
    let copies = 0
    await assert.rejects(publishImmutableReleaseSet({
      artifacts: staged.slice(0, 4).map((stagedPath, index) => ({ stagedPath, destinationPath: destinations[index] })),
      completionArtifact: { stagedPath: staged[4], destinationPath: destinations[4] },
      async copy(source, destination, flags) {
        copies += 1
        for (const output of outputSet) assert.equal(existsSync(output), false, 'no final output appears during staging')
        assert.notEqual(destination, destinations[4])
        assert.equal(flags, fsConstants.COPYFILE_EXCL)
        if (copies === 5) {
          await writeFile(destination, 'partial completion marker')
          throw new Error('simulated partial completion copy failure')
        }
        await copyFile(source, destination, flags)
      },
    }), /simulated partial completion copy failure/)
    assert.equal(copies, 5)
    for (const output of outputSet) assert.equal(existsSync(output), false)
    await assertNoStagingDirectories(directory)

    await writeFile(destinations[4], 'pre-existing completion marker')
    await assert.rejects(publishImmutableReleaseSet({
      artifacts: staged.slice(0, 4).map((stagedPath, index) => ({ stagedPath, destinationPath: destinations[index] })),
      completionArtifact: { stagedPath: staged[4], destinationPath: destinations[4] },
    }), /EEXIST/)
    for (const output of destinations.slice(0, 4)) assert.equal(existsSync(output), false, 'newly linked files roll back on marker collision')
    assert.equal(await readFile(destinations[4], 'utf8'), 'pre-existing completion marker')
    await assertNoStagingDirectories(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release-set links each final artifact and the completion marker last', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-link-order-test-'))
  try {
    const staged = ['arm.zip', 'intel.zip', 'arm.update.json', 'release.json']
      .map((name) => join(directory, `staged-${name}`))
    const destinations = ['arm.zip', 'intel.zip', 'arm.update.json', 'release.json']
      .map((name) => join(directory, name))
    for (const [index, path] of staged.entries()) await writeFile(path, `staged-${index}`)
    const order: string[] = []

    await publishImmutableReleaseSet({
      artifacts: staged.slice(0, 3).map((stagedPath, index) => ({ stagedPath, destinationPath: destinations[index] })),
      completionArtifact: { stagedPath: staged[3], destinationPath: destinations[3] },
      async linkFile(source, destination) {
        order.push(destination)
        if (destination === destinations[3]) {
          for (const dataPath of destinations.slice(0, 3)) {
            assert.equal(existsSync(dataPath), true, 'all release files exist before the completion marker is linked')
          }
        }
        await link(source, destination)
      },
    })

    assert.deepEqual(order, destinations)
    for (const [index, destination] of destinations.entries()) {
      assert.equal(await readFile(destination, 'utf8'), `staged-${index}`)
    }
    await assertNoStagingDirectories(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release-set link failure rolls back only prior successful links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-link-failure-test-'))
  try {
    const staged = ['arm.zip', 'intel.zip', 'release.json']
      .map((name) => join(directory, `staged-${name}`))
    const destinations = ['arm.zip', 'intel.zip', 'release.json']
      .map((name) => join(directory, name))
    for (const [index, path] of staged.entries()) await writeFile(path, `staged-${index}`)
    await writeFile(destinations[2], 'pre-existing completion marker')
    const linked: string[] = []

    await assert.rejects(publishImmutableReleaseSet({
      artifacts: staged.slice(0, 2).map((stagedPath, index) => ({ stagedPath, destinationPath: destinations[index] })),
      completionArtifact: { stagedPath: staged[2], destinationPath: destinations[2] },
      async linkFile(source, destination) {
        linked.push(destination)
        if (destination === destinations[1]) throw new Error('simulated hard-link failure')
        await link(source, destination)
      },
    }), /simulated hard-link failure/)

    assert.deepEqual(linked, destinations.slice(0, 2))
    assert.equal(existsSync(destinations[0]), false, 'the successfully linked first artifact is rolled back')
    assert.equal(existsSync(destinations[1]), false, 'a failed link does not create a destination')
    assert.equal(await readFile(destinations[2], 'utf8'), 'pre-existing completion marker')
    await assertNoStagingDirectories(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('successful links roll back if private staging cleanup fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-stage-cleanup-test-'))
  try {
    const staged = ['arm.zip', 'release.json'].map((name) => join(directory, `staged-${name}`))
    const destinations = ['arm.zip', 'release.json'].map((name) => join(directory, name))
    for (const [index, path] of staged.entries()) await writeFile(path, `staged-${index}`)
    let injectedCleanupFailure = false

    await assert.rejects(publishImmutableReleaseSet({
      artifacts: [{ stagedPath: staged[0], destinationPath: destinations[0] }],
      completionArtifact: { stagedPath: staged[1], destinationPath: destinations[1] },
      async remove(path, options) {
        await rm(path, options)
        if (!injectedCleanupFailure && path.includes(stagingPrefix)) {
          injectedCleanupFailure = true
          throw new Error('simulated private staging cleanup failure')
        }
      },
    }), (error: unknown) => {
      assert.equal(error instanceof AggregateError, true)
      const aggregate = error as AggregateError
      assert.match(aggregate.message, /private staging cleanup failed/i)
      assert.equal(aggregate.errors.some((entry) => entry instanceof Error && entry.message === 'simulated private staging cleanup failure'), true)
      return true
    })

    assert.equal(injectedCleanupFailure, true)
    for (const destination of destinations) assert.equal(existsSync(destination), false)
    await assertNoStagingDirectories(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release-set cleanup failure reports the original publication and cleanup errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-cleanup-test-'))
  try {
    const staged = [join(directory, 'staged-one'), join(directory, 'staged-two')]
    const destinations = [join(directory, 'one'), join(directory, 'collision')]
    await writeFile(staged[0], 'one')
    await writeFile(staged[1], 'two')
    await writeFile(destinations[1], 'pre-existing')

    let injectedRemove = false
    await assert.rejects(publishImmutableReleaseSet({
      artifacts: [{ stagedPath: staged[0], destinationPath: destinations[0] }],
      completionArtifact: { stagedPath: staged[1], destinationPath: destinations[1] },
      async remove(path, options) {
        if (path === destinations[0]) {
          injectedRemove = true
          throw new Error('simulated rollback cleanup failure')
        }
        await rm(path, options)
      },
    }), (error: unknown) => {
      assert.equal(error instanceof AggregateError, true)
      const aggregate = error as AggregateError
      assert.match(aggregate.message, /rollback|cleanup/i)
      assert.equal(aggregate.errors.some((entry) => entry instanceof Error && entry.message === 'simulated rollback cleanup failure'), true)
      assert.equal(aggregate.errors.some((entry) => (entry as NodeJS.ErrnoException)?.code === 'EEXIST'), true)
      return true
    })

    assert.equal(injectedRemove, true)
    assert.equal(await readFile(destinations[1], 'utf8'), 'pre-existing')
    await assertNoStagingDirectories(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
