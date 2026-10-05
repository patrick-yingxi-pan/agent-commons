import { lstat } from 'node:fs/promises'
import { buildDesktopProfileHelper } from './profileHelperBuild.mjs'
import { buildGitFileHelper } from './gitFileBuild.mjs'
import { buildBundledGit } from './bundledGitBuild.mjs'
import { bundledGitDirectory, verifyBundledGitDirectory } from './bundledGit.mjs'
import { fileURLToPath } from 'node:url'

/** Prepare source-tree native dependencies for `electron .` without rebuilding
 * a previously verified pinned Git bundle on every ordinary launch. Packaging
 * deliberately uses its own unconditional target build path. */
export async function buildDesktopNativeRuntime({ targetPlatform = process.platform, targetArch = process.arch } = {}) {
  const profileHelper = buildDesktopProfileHelper({ targetPlatform, targetArch })
  const gitFileHelper = buildGitFileHelper({ targetPlatform, targetArch })
  if (targetPlatform !== 'darwin') return { profileHelper, gitFileHelper, gitDirectory: null }

  const gitDirectory = bundledGitDirectory({ packaged: false, targetPlatform, targetArch })
  let existingBundle = true
  try {
    await lstat(gitDirectory)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    existingBundle = false
  }
  if (existingBundle) {
    await verifyBundledGitDirectory(gitDirectory, { targetArch, execute: true })
  } else {
    await buildBundledGit({ targetPlatform, targetArch })
    await verifyBundledGitDirectory(gitDirectory, { targetArch, execute: true })
  }
  return { profileHelper, gitFileHelper, gitDirectory }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildDesktopNativeRuntime()
