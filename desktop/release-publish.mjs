import { constants as fsConstants } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'

/** Publish the already-verified archive and checksum without overwriting an
 * existing version. Publish the checksum first so the downloadable archive is
 * never visible without its verifier; roll back that checksum if the second
 * exclusive copy fails. */
export async function publishImmutableReleasePair({
  stagedArchive,
  stagedChecksum,
  archivePath,
  checksumPath,
  copy = copyFile,
  remove = rm,
}) {
  let checksumPublished = false
  try {
    await copy(stagedChecksum, checksumPath, fsConstants.COPYFILE_EXCL)
    checksumPublished = true
    await copy(stagedArchive, archivePath, fsConstants.COPYFILE_EXCL)
  } catch (error) {
    if (checksumPublished) await remove(checksumPath, { force: true })
    throw error
  }
}
