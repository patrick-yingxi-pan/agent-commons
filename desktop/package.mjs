import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'
import { generateDesktopIcons, verifyPackagedDesktopIcon } from './icons.mjs'
import packagerConfig from './packager.config.mjs'
import { buildDesktopProfileHelper } from './profileHelperBuild.mjs'
import { buildGitFileHelper } from './gitFileBuild.mjs'
import { buildImageOcrHelper } from './ocrHelperBuild.mjs'
import { buildPdfOcrHelper, relocatePdfOcrBrokerAfterCopyExtraResources } from './pdfOcrHelperBuild.mjs'
import { buildBundledGit } from './bundledGitBuild.mjs'
import { verifyBundledGitDirectory } from './bundledGit.mjs'

const require = createRequire(import.meta.url)
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
const ELECTRON_PACKAGE = require.resolve('electron/package.json')
const electronRequire = createRequire(ELECTRON_PACKAGE)
const { downloadArtifact } = electronRequire('@electron/get')
const electronManifest = JSON.parse(await readFile(ELECTRON_PACKAGE, 'utf8'))
const electronChecksums = JSON.parse(await readFile(join(dirname(ELECTRON_PACKAGE), 'checksums.json'), 'utf8'))

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`))
    })
  })
}

/** Build one unpacked application. Release-only signing options arrive from the
 * credential-gated release orchestrator; the ordinary package command remains
 * deterministic and unsigned for local verification. */
export async function packageDesktop({
  targetPlatform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform,
  targetArch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch,
  releaseOptions,
} = {}) {
  const profileHelperPath = buildDesktopProfileHelper({ targetPlatform, targetArch })
  const gitFileHelperPath = buildGitFileHelper({ targetPlatform, targetArch })
  const imageOcrHelperPath = buildImageOcrHelper({ targetPlatform, targetArch })
  const pdfOcrBrokerBundlePath = buildPdfOcrHelper({ targetPlatform, targetArch })
  const gitDirectory = await buildBundledGit({ targetPlatform, targetArch })
  await generateDesktopIcons()
  await run(process.execPath, [VITE_BIN, 'build'])

  // Resolve the exact distribution archive through Electron's own current
  // downloader, and always verify it against checksums shipped in the official
  // `electron` npm package. Passing the resulting local directory to Packager
  // avoids its older nested downloader (which does not settle under Node 26).
  const zipPath = await downloadArtifact({
    version: electronManifest.version,
    artifactName: 'electron',
    platform: targetPlatform,
    arch: targetArch,
    checksums: electronChecksums,
    ...(process.env.ELECTRON_MIRROR
      ? { mirrorOptions: { mirror: process.env.ELECTRON_MIRROR } }
      : {}),
  })

  const artifacts = await packager({
    ...packagerConfig,
    dir: ROOT,
    out: join(ROOT, 'out'),
    overwrite: true,
    electronVersion: electronManifest.version,
    electronZipDir: dirname(zipPath),
    platform: targetPlatform,
    arch: targetArch,
    extraResource: [profileHelperPath, gitDirectory, gitFileHelperPath, imageOcrHelperPath, pdfOcrBrokerBundlePath].filter(Boolean),
    ...(releaseOptions ?? {}),
    afterCopyExtraResources: [
      ...[].concat(releaseOptions?.afterCopyExtraResources ?? []),
      relocatePdfOcrBrokerAfterCopyExtraResources,
    ],
  })
  if (!artifacts.length || artifacts.some((artifact) => !existsSync(artifact))) {
    throw new Error('Electron Packager completed without a concrete application artifact.')
  }
  await Promise.all(artifacts.map((artifactPath) => verifyPackagedDesktopIcon({
    artifactPath,
    targetPlatform,
  })))
  if (targetPlatform === 'darwin') {
    for (const artifact of artifacts) {
      const helperPath = join(artifact, 'Agent Commons.app', 'Contents', 'Resources', 'agent-commons-git-file')
      if (!existsSync(helperPath)) throw new Error('The packaged macOS Git file helper is missing.')
      const ocrPath = join(artifact, 'Agent Commons.app', 'Contents', 'Resources', 'agent-commons-image-ocr')
      if (!existsSync(ocrPath)) throw new Error('The packaged macOS image OCR helper is missing.')
      const pdfOcrBundle = join(artifact, 'Agent Commons.app', 'Contents', 'Helpers', 'Agent Commons PDF OCR.app')
      const pdfOcrBroker = join(pdfOcrBundle, 'Contents', 'MacOS', 'agent-commons-pdf-ocr')
      const pdfOcrService = join(pdfOcrBundle, 'Contents', 'XPCServices', 'com.agentcommons.desktop.pdf-ocr.service.xpc', 'Contents', 'MacOS', 'agent-commons-pdf-ocr-service')
      if (!existsSync(pdfOcrBroker) || !existsSync(pdfOcrService)) throw new Error('The packaged macOS PDF OCR broker or sandboxed service is missing.')
    }
    for (const artifact of artifacts) await verifyBundledGitDirectory(
      join(artifact, 'Agent Commons.app', 'Contents', 'Resources', 'agent-commons-git'),
      { targetArch, execute: targetArch === process.arch },
    )
  }
  if (targetPlatform === 'darwin') console.log('[desktop-package] verified canonical macOS app icon')
  for (const artifact of artifacts) console.log(`[desktop-package] ${artifact}`)
  return artifacts
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await packageDesktop()
