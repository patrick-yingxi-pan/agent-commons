import { constants as fsConstants } from 'node:fs'
import { copyFile, link, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const STAGING_PREFIX = '.agent-commons-release-publish-'

async function publishExclusive(publications, { copy, linkFile, remove, label }) {
  const destinations = publications.map((artifact) => artifact.destinationPath)
  if (new Set(destinations).size !== destinations.length) {
    throw new Error(`${label} publication destinations must be unique.`)
  }

  const stagingDirectories = []
  const stagedArtifacts = []
  const linkedDestinations = []
  try {
    // Finish every potentially partial copy before exposing any final path.
    // Each temporary directory lives under its destination parent, ensuring
    // the subsequent hard link is on the same filesystem and can publish
    // atomically without replacing an existing file.
    for (const artifact of publications) {
      const stagingDirectory = await mkdtemp(join(dirname(artifact.destinationPath), STAGING_PREFIX))
      stagingDirectories.push(stagingDirectory)
      const stagingPath = join(stagingDirectory, 'artifact')
      await copy(artifact.stagedPath, stagingPath, fsConstants.COPYFILE_EXCL)
      stagedArtifacts.push({ stagingPath, destinationPath: artifact.destinationPath })
    }

    for (const artifact of stagedArtifacts) {
      await linkFile(artifact.stagingPath, artifact.destinationPath)
      linkedDestinations.push(artifact.destinationPath)
    }
  } catch (error) {
    const cleanupErrors = await cleanupPublication({
      linkedDestinations,
      stagingDirectories,
      remove,
    })
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], `${label} publication failed and rollback/cleanup was incomplete.`)
    }
    throw error
  }

  const cleanupErrors = await cleanupPublication({ stagingDirectories, remove })
  if (cleanupErrors.length > 0) {
    const rollbackErrors = await rollbackDestinations(linkedDestinations, remove)
    throw new AggregateError(
      [...cleanupErrors, ...rollbackErrors],
      `${label} publication completed but private staging cleanup failed; published outputs were rolled back where possible.`,
    )
  }
}

async function rollbackDestinations(destinations, remove) {
  const errors = []
  for (const path of [...destinations].reverse()) {
    try {
      await remove(path, { force: true })
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

async function cleanupPublication({ linkedDestinations = [], stagingDirectories, remove }) {
  const errors = await rollbackDestinations(linkedDestinations, remove)
  for (const path of [...stagingDirectories].reverse()) {
    try {
      await remove(path, { recursive: true, force: true })
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

/** Publish already-verified release artifacts without overwriting a version.
 * Every verifier and the archive are copied into private staging first, then
 * linked into place exclusively; a failed or partial copy never touches a
 * public destination. */
export async function publishImmutableRelease({
  stagedArchive,
  archivePath,
  auxiliaryArtifacts,
  copy = copyFile,
  linkFile = link,
  remove = rm,
}) {
  if (!Array.isArray(auxiliaryArtifacts) || auxiliaryArtifacts.length === 0) {
    throw new Error('Immutable release publication requires auxiliary verification artifacts.')
  }
  const publications = [...auxiliaryArtifacts, { stagedPath: stagedArchive, destinationPath: archivePath }]
  if (publications.some((artifact) => (
    typeof artifact?.stagedPath !== 'string' || artifact.stagedPath.length === 0 ||
    typeof artifact?.destinationPath !== 'string' || artifact.destinationPath.length === 0
  ))) {
    throw new Error('Immutable release publication requires explicit source and destination paths.')
  }
  await publishExclusive(publications, { copy, linkFile, remove, label: 'Release' })
}

/** Publish a complete multi-architecture release as one logical set. All
 * candidate files are staged first, then each is atomically linked into place
 * with the completion manifest last. A failed publication rolls back every
 * destination successfully linked by this invocation. */
export async function publishImmutableReleaseSet({
  artifacts,
  completionArtifact,
  copy = copyFile,
  linkFile = link,
  remove = rm,
}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('Immutable release-set publication requires candidate artifacts.')
  }
  const publications = [...artifacts, completionArtifact]
  if (publications.some((artifact) => (
    typeof artifact?.stagedPath !== 'string' || artifact.stagedPath.length === 0 ||
    typeof artifact?.destinationPath !== 'string' || artifact.destinationPath.length === 0
  ))) {
    throw new Error('Immutable release-set publication requires explicit source and destination paths.')
  }
  await publishExclusive(publications, { copy, linkFile, remove, label: 'Release-set' })
}
