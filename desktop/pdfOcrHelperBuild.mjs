import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = dirname(fileURLToPath(import.meta.url))
const NATIVE_ROOT = join(DESKTOP_ROOT, 'native')
const DEFAULT_OUTPUT_PATH = join(DESKTOP_ROOT, 'bin', 'Agent Commons PDF OCR.app')
const BROKER_BUNDLE_NAME = basename(DEFAULT_OUTPUT_PATH)
const BROKER_ID = 'com.agentcommons.desktop.pdf-ocr.broker'
const SERVICE_ID = 'com.agentcommons.desktop.pdf-ocr.service'
const BROKER_NAME = 'agent-commons-pdf-ocr'
const BROKER_CONTAINER_NAME = 'agent-commons-pdf-ocr-container'
const SERVICE_NAME = 'agent-commons-pdf-ocr-service'
const MINIMUM_SYSTEM_VERSION = '13.0'

function compilerArchitecture(targetArch) {
  if (targetArch === 'arm64') return 'arm64'
  if (targetArch === 'x64') return 'x86_64'
  throw new Error(`The macOS PDF OCR helper does not support architecture ${targetArch}.`)
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function plist(contents) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${contents}\n</dict>\n</plist>\n`
}

function stringEntry(key, value) {
  return `  <key>${xml(key)}</key><string>${xml(value)}</string>`
}

function bundleInfo({ identifier, executable, packageType, displayName, service = false, agent = false, adHocBrokerRequirement }) {
  const entries = [
    stringEntry('CFBundleDevelopmentRegion', 'en'),
    stringEntry('CFBundleExecutable', executable),
    stringEntry('CFBundleIdentifier', identifier),
    stringEntry('CFBundleName', displayName),
    stringEntry('CFBundlePackageType', packageType),
    stringEntry('CFBundleShortVersionString', '1.0'),
    stringEntry('CFBundleVersion', '1'),
    stringEntry('LSMinimumSystemVersion', MINIMUM_SYSTEM_VERSION),
  ]
  if (agent) entries.push('  <key>LSUIElement</key><true/>')
  if (service) {
    entries.push('  <key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>')
    entries.push(stringEntry('ACPdfOcrAdHocBrokerRequirement', adHocBrokerRequirement ?? ''))
  }
  return plist(entries.join('\n'))
}

export function pdfOcrBrokerExecutable(bundlePath = DEFAULT_OUTPUT_PATH) {
  if (typeof bundlePath !== 'string' || !isAbsolute(bundlePath)) {
    throw new Error('The macOS PDF OCR broker bundle path must be absolute.')
  }
  return join(bundlePath, 'Contents', 'MacOS', BROKER_NAME)
}

/** Packager copies extraResource items into Contents/Resources. Relocate this
 * nested app to a standard code location before its outer app is signed. */
export function relocatePdfOcrBrokerAfterCopyExtraResources({ buildPath, platform } = {}) {
  if (platform !== 'darwin') return null
  if (typeof buildPath !== 'string' || !isAbsolute(buildPath)) throw new Error('The macOS packaged app path must be absolute.')
  // Packager passes its staging root here; the actual product bundle is one
  // level beneath it (unlike afterCopy's Resources/app hook argument).
  const contents = join(buildPath, 'Agent Commons.app', 'Contents')
  const resourcesBundle = join(contents, 'Resources', BROKER_BUNDLE_NAME)
  const helpersDirectory = join(contents, 'Helpers')
  const helpersBundle = join(helpersDirectory, BROKER_BUNDLE_NAME)
  if (!existsSync(resourcesBundle)) throw new Error('The copied PDF OCR broker bundle is missing from app Resources.')
  mkdirSync(helpersDirectory, { recursive: true })
  renameSync(resourcesBundle, helpersBundle)
  return helpersBundle
}

export function pdfOcrHelperBuildPlan({ targetPlatform = process.platform, targetArch = process.arch, outputPath = DEFAULT_OUTPUT_PATH } = {}) {
  if (targetPlatform !== 'darwin') return null
  const arch = compilerArchitecture(targetArch)
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath)) throw new Error('The macOS PDF OCR helper output path must be absolute.')

  const brokerExecutablePath = pdfOcrBrokerExecutable(outputPath)
  const brokerContainerPath = join(dirname(brokerExecutablePath), BROKER_CONTAINER_NAME)
  const brokerDirectory = dirname(brokerExecutablePath)
  const serviceBundlePath = join(outputPath, 'Contents', 'XPCServices', `${SERVICE_ID}.xpc`)
  const serviceExecutablePath = join(serviceBundlePath, 'Contents', 'MacOS', SERVICE_NAME)
  const serviceDirectory = dirname(serviceExecutablePath)
  const brokerArgs = [
    '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-O2', `-mmacosx-version-min=${MINIMUM_SYSTEM_VERSION}`, '-arch', arch,
    join(NATIVE_ROOT, 'pdf-ocr-broker.m'), join(NATIVE_ROOT, 'pdf-ocr-peer.m'),
    '-framework', 'Foundation', '-framework', 'Security', '-o', brokerExecutablePath,
  ]
  const brokerContainerArgs = [
    '-Wall', '-Wextra', '-Werror', '-O2', `-mmacosx-version-min=${MINIMUM_SYSTEM_VERSION}`, '-arch', arch,
    join(NATIVE_ROOT, 'pdf-ocr-container.c'), '-o', brokerContainerPath,
  ]
  const serviceArgs = [
    '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-O2', `-mmacosx-version-min=${MINIMUM_SYSTEM_VERSION}`, '-arch', arch,
    join(NATIVE_ROOT, 'pdf-ocr-service.m'), join(NATIVE_ROOT, 'pdf-ocr-peer.m'), join(NATIVE_ROOT, 'pdf-ocr.m'),
    '-framework', 'Foundation', '-framework', 'Security', '-framework', 'CoreGraphics', '-framework', 'Vision', '-o', serviceExecutablePath,
  ]
  return {
    compiler: '/usr/bin/clang', signer: '/usr/bin/codesign', outputPath,
    brokerExecutablePath, brokerContainerPath, serviceBundlePath, serviceExecutablePath,
    brokerInfoPath: join(outputPath, 'Contents', 'Info.plist'),
    serviceInfoPath: join(serviceBundlePath, 'Contents', 'Info.plist'),
    brokerInfo: bundleInfo({ identifier: BROKER_ID, executable: BROKER_CONTAINER_NAME, packageType: 'APPL', displayName: 'Agent Commons PDF OCR', agent: true }),
    serviceInfo: bundleInfo({ identifier: SERVICE_ID, executable: SERVICE_NAME, packageType: 'XPC!', displayName: 'Agent Commons PDF OCR Service', service: true }),
    brokerArgs, brokerContainerArgs, serviceArgs,
    entitlementPath: join(DESKTOP_ROOT, 'entitlements.pdf-ocr.plist'),
    brokerEntitlementPath: join(DESKTOP_ROOT, 'entitlements.git.plist'),
    transportSignArgs: ['--force', '--sign', '-', '--identifier', BROKER_ID, '--entitlements', join(DESKTOP_ROOT, 'entitlements.git.plist'), brokerExecutablePath],
    transportRequirementArgs: ['-d', '-r-', brokerExecutablePath],
    serviceSignArgs: ['--force', '--sign', '-', '--entitlements', join(DESKTOP_ROOT, 'entitlements.pdf-ocr.plist'), serviceBundlePath],
    brokerSignArgs: ['--force', '--sign', '-', '--entitlements', join(DESKTOP_ROOT, 'entitlements.git.plist'), outputPath],
    brokerDirectory, serviceDirectory,
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/private/tmp' },
  })
  if (result.error) throw new Error(`Could not run ${command} to ${label}.`, { cause: result.error })
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || '').trim()
    throw new Error(`Could not ${label}${diagnostic ? `: ${diagnostic}` : '.'}`)
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

export function adHocBrokerRequirement(codesignOutput) {
  if (typeof codesignOutput !== 'string') throw new Error('The ad-hoc PDF OCR broker signing requirement is unavailable.')
  const match = codesignOutput.match(/^(?:# )?designated => cdhash H"([a-fA-F0-9]{40})"$/m)
  if (!match) throw new Error('The ad-hoc PDF OCR broker signing requirement was not an exact cdhash requirement.')
  return `cdhash H"${match[1].toLowerCase()}"`
}

export function buildPdfOcrHelper({ targetPlatform = process.platform, targetArch = process.arch, outputPath = DEFAULT_OUTPUT_PATH } = {}) {
  const plan = pdfOcrHelperBuildPlan({ targetPlatform, targetArch, outputPath })
  if (!plan) return null
  if (process.platform !== 'darwin') throw new Error('Building the macOS PDF OCR helper requires a macOS host with /usr/bin/clang and /usr/bin/codesign.')
  const sources = [
    join(NATIVE_ROOT, 'pdf-ocr-broker.m'), join(NATIVE_ROOT, 'pdf-ocr-container.c'), join(NATIVE_ROOT, 'pdf-ocr-service.m'),
    join(NATIVE_ROOT, 'pdf-ocr-peer.m'), join(NATIVE_ROOT, 'pdf-ocr-peer.h'), join(NATIVE_ROOT, 'pdf-ocr.m'),
  ]
  if (sources.some((path) => !existsSync(path))) throw new Error('A macOS PDF OCR broker or service source is missing.')
  if (!existsSync(plan.entitlementPath) || !existsSync(plan.brokerEntitlementPath)) throw new Error('The macOS PDF OCR signing entitlements are missing.')

  mkdirSync(plan.brokerDirectory, { recursive: true })
  mkdirSync(plan.serviceDirectory, { recursive: true })
  writeFileSync(plan.brokerInfoPath, plan.brokerInfo, { mode: 0o644 })
  run(plan.compiler, plan.brokerArgs, 'build the macOS PDF OCR broker')
  chmodSync(plan.brokerExecutablePath, 0o755)
  run(plan.compiler, plan.brokerContainerArgs, 'build the macOS PDF OCR bundle container')
  chmodSync(plan.brokerContainerPath, 0o755)
  run(plan.signer, plan.transportSignArgs, 'ad-hoc sign the PDF OCR byte transport')
  const requirementOutput = run(plan.signer, plan.transportRequirementArgs, 'read the PDF OCR transport designated requirement')
  const requirement = adHocBrokerRequirement(requirementOutput)
  writeFileSync(plan.serviceInfoPath, bundleInfo({
    identifier: SERVICE_ID, executable: SERVICE_NAME, packageType: 'XPC!',
    displayName: 'Agent Commons PDF OCR Service', service: true, adHocBrokerRequirement: requirement,
  }), { mode: 0o644 })
  run(plan.compiler, plan.serviceArgs, 'build the macOS PDF OCR XPC service')
  chmodSync(plan.serviceExecutablePath, 0o755)
  run(plan.signer, plan.serviceSignArgs, 'ad-hoc sign the sandboxed PDF OCR XPC service')
  run(plan.signer, plan.brokerSignArgs, 'ad-hoc sign the PDF OCR broker app')
  return outputPath
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildPdfOcrHelper()
