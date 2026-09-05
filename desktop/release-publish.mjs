import { constants as fsConstants } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'

/** Publish already-verified release artifacts without overwriting a version.
 * Auxiliary evidence is copied first and the downloadable archive last, so an
 * archive is never visible without all of its verifiers. Any partial set from
 * this invocation is rolled back if a later exclusive copy fails. */
export async function publishImmutableRelease({
  stagedArchive,
  archivePath,
  auxiliaryArtifacts,
  copy = copyFile,
  remove = rm,
}) {
  if (!Array.isArray(auxiliaryArtifacts) || auxiliaryArtifacts.length === 0) {
    throw new Error('Immutable release publication requires auxiliary verification artifacts.')
  }
  const destinations = [...auxiliaryArtifacts.map((artifact) => artifact.destinationPath), archivePath]
  if (destinations.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new Error('Immutable release publication requires explicit destination paths.')
  }
  if (new Set(destinations).size !== destinations.length) {
    throw new Error('Immutable release publication destinations must be unique.')
  }

  const published = []
  try {
    for (const artifact of auxiliaryArtifacts) {
      await copy(artifact.stagedPath, artifact.destinationPath, fsConstants.COPYFILE_EXCL)
      published.push(artifact.destinationPath)
    }
    await copy(stagedArchive, archivePath, fsConstants.COPYFILE_EXCL)
  } catch (error) {
    const cleanupErrors = []
    for (const path of published.reverse()) {
      try {
        await remove(path, { force: true })
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], 'Release publication failed and rollback was incomplete.')
    }
    throw error
  }
}

/** Publish a complete multi-architecture release as one logical set. Every
 * candidate file is copied exclusively before the release manifest, which is
 * the only completion marker. A failed copy removes every file created by this
 * invocation, so one architecture can never become a completed release alone. */
export async function publishImmutableReleaseSet({
  artifacts,
  completionArtifact,
  copy = copyFile,
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
  const destinations = publications.map((artifact) => artifact.destinationPath)
  if (new Set(destinations).size !== destinations.length) {
    throw new Error('Immutable release-set publication destinations must be unique.')
  }

  const published = []
  try {
    for (const artifact of publications) {
      await copy(artifact.stagedPath, artifact.destinationPath, fsConstants.COPYFILE_EXCL)
      published.push(artifact.destinationPath)
    }
  } catch (error) {
    const cleanupErrors = []
    for (const path of published.reverse()) {
      try {
        await remove(path, { force: true })
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], 'Release-set publication failed and rollback was incomplete.')
    }
    throw error
  }
}
