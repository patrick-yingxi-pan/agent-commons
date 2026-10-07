import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  adHocBrokerRequirement,
  buildPdfOcrHelper,
  pdfOcrBrokerExecutable,
  pdfOcrHelperBuildPlan,
  relocatePdfOcrBrokerAfterCopyExtraResources,
} from './pdfOcrHelperBuild.mjs'

test('PDF OCR broker bundle build is macOS-only, architecture-bounded and separates its sandboxed XPC service', () => {
  assert.equal(buildPdfOcrHelper({ targetPlatform: 'linux', targetArch: 'x64' }), null)
  assert.equal(pdfOcrHelperBuildPlan({ targetPlatform: 'win32', targetArch: 'x64' }), null)
  const bundle = fileURLToPath(new URL('./bin/Agent Commons PDF OCR.app', import.meta.url))
  const arm = pdfOcrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'arm64', outputPath: '/tmp/Agent Commons PDF OCR.app' })
  assert.equal(arm.compiler, '/usr/bin/clang')
  assert.equal(arm.signer, '/usr/bin/codesign')
  assert.equal(arm.outputPath, '/tmp/Agent Commons PDF OCR.app')
  assert.equal(arm.brokerExecutablePath, '/tmp/Agent Commons PDF OCR.app/Contents/MacOS/agent-commons-pdf-ocr')
  assert.equal(arm.brokerContainerPath, '/tmp/Agent Commons PDF OCR.app/Contents/MacOS/agent-commons-pdf-ocr-container')
  assert.equal(pdfOcrBrokerExecutable(arm.outputPath), arm.brokerExecutablePath)
  assert.equal(arm.serviceExecutablePath, '/tmp/Agent Commons PDF OCR.app/Contents/XPCServices/com.agentcommons.desktop.pdf-ocr.service.xpc/Contents/MacOS/agent-commons-pdf-ocr-service')
  for (const args of [arm.brokerArgs, arm.serviceArgs]) {
    assert.deepEqual(args.slice(0, 8), ['-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=13.0', '-arch', 'arm64'])
    assert.equal(args.at(-1), args === arm.brokerArgs ? arm.brokerExecutablePath : arm.serviceExecutablePath)
    assert.equal(args.some((arg) => /(^|\/)node_modules\//.test(arg)), false)
  }
  assert.deepEqual(arm.brokerContainerArgs.slice(0, 7), ['-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=13.0', '-arch', 'arm64'])
  assert.equal(arm.brokerContainerArgs.at(-1), arm.brokerContainerPath)
  assert.equal(arm.brokerContainerArgs.some((arg) => /-framework|pdf-ocr\.m/.test(arg)), false, 'the bundle container is inert and has no OCR engine')
  for (const [framework, args] of [
    ...['Foundation', 'Security'].map((framework) => [framework, arm.brokerArgs]),
    ...['Foundation', 'Security', 'CoreGraphics', 'Vision'].map((framework) => [framework, arm.serviceArgs]),
  ]) assert.ok(args.some((arg, index) => arg === framework && args[index - 1] === '-framework'))
  assert.equal(arm.brokerArgs.includes('Vision'), false, 'the unsandboxed broker has no image/PDF processing frameworks')
  assert.match(arm.brokerInfo, /com\.agentcommons\.desktop\.pdf-ocr\.broker/)
  assert.match(arm.brokerInfo, /<key>CFBundleExecutable<\/key><string>agent-commons-pdf-ocr-container<\/string>/)
  assert.match(arm.brokerInfo, /<key>CFBundlePackageType<\/key><string>APPL<\/string>/)
  assert.match(arm.brokerInfo, /<key>LSUIElement<\/key><true\/>/)
  assert.match(arm.serviceInfo, /com\.agentcommons\.desktop\.pdf-ocr\.service/)
  assert.match(arm.serviceInfo, /<key>CFBundlePackageType<\/key><string>XPC!<\/string>/)
  assert.match(arm.serviceInfo, /<key>XPCService<\/key><dict><key>ServiceType<\/key><string>Application<\/string><\/dict>/)
  assert.match(arm.serviceInfo, /ACPdfOcrAdHocBrokerRequirement/)
  assert.match(arm.entitlementPath, /entitlements\.pdf-ocr\.plist$/)
  assert.match(arm.brokerEntitlementPath, /entitlements\.git\.plist$/)
  assert.deepEqual(arm.serviceSignArgs.slice(0, 4), ['--force', '--sign', '-', '--entitlements'])
  assert.deepEqual(arm.transportSignArgs.slice(0, 6), ['--force', '--sign', '-', '--identifier', 'com.agentcommons.desktop.pdf-ocr.broker', '--entitlements'])
  assert.deepEqual(arm.transportRequirementArgs, ['-d', '-r-', arm.brokerExecutablePath])
  assert.deepEqual(arm.brokerSignArgs.slice(0, 4), ['--force', '--sign', '-', '--entitlements'])
  assert.equal(adHocBrokerRequirement('Executable=/app/agent-commons-pdf-ocr\ndesignated => cdhash H"0123456789abcdef0123456789abcdef01234567"'), 'cdhash H"0123456789abcdef0123456789abcdef01234567"')
  assert.equal(adHocBrokerRequirement('Executable=/app/agent-commons-pdf-ocr\n# designated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n'), 'cdhash H"0123456789abcdef0123456789abcdef01234567"')
  assert.throws(() => adHocBrokerRequirement('designated => identifier "com.agentcommons.desktop.pdf-ocr.broker"'), /not an exact cdhash/)
  assert.throws(() => adHocBrokerRequirement('designated => cdhash H"0123456789abcdef0123456789abcdef01234567" or true'), /not an exact cdhash/)
  const builder = readFileSync(new URL('./pdfOcrHelperBuild.mjs', import.meta.url), 'utf8')
  assert.ok(builder.indexOf("'ad-hoc sign the PDF OCR byte transport'") < builder.indexOf("'read the PDF OCR transport designated requirement'"))
  assert.ok(builder.indexOf("'read the PDF OCR transport designated requirement'") < builder.indexOf('adHocBrokerRequirement(requirementOutput)'))
  assert.ok(builder.indexOf('adHocBrokerRequirement(requirementOutput)') < builder.indexOf("'ad-hoc sign the sandboxed PDF OCR XPC service'"))
  assert.ok(builder.indexOf("'ad-hoc sign the sandboxed PDF OCR XPC service'") < builder.indexOf("'ad-hoc sign the PDF OCR broker app'"))
  assert.ok(bundle.endsWith('/desktop/bin/Agent Commons PDF OCR.app'))
  const intel = pdfOcrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'x64' })
  assert.equal(intel.brokerArgs[intel.brokerArgs.indexOf('-arch') + 1], 'x86_64')
  assert.equal(intel.serviceArgs[intel.serviceArgs.indexOf('-arch') + 1], 'x86_64')
  assert.equal(intel.outputPath, bundle)
  assert.throws(() => pdfOcrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'ia32' }), /does not support architecture/)
  assert.throws(() => pdfOcrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'arm64', outputPath: 'relative/path' }), /output path must be absolute/)
  assert.throws(() => pdfOcrBrokerExecutable('relative/path'), /bundle path must be absolute/)
})

test('the copied broker app is relocated from Resources to standard Contents/Helpers before signing', () => {
  const root = mkdtempSync(join(tmpdir(), 'pdf-ocr-relocation-test-'))
  try {
    const staging = root
    const app = join(staging, 'Agent Commons.app')
    const bundle = join(app, 'Contents', 'Resources', 'Agent Commons PDF OCR.app')
    mkdirSync(bundle, { recursive: true })
    assert.equal(relocatePdfOcrBrokerAfterCopyExtraResources({ buildPath: staging, platform: 'linux' }), null)
    const moved = relocatePdfOcrBrokerAfterCopyExtraResources({ buildPath: staging, platform: 'darwin' })
    assert.equal(moved, join(staging, 'Agent Commons.app', 'Contents', 'Helpers', 'Agent Commons PDF OCR.app'))
    assert.equal(existsSync(bundle), false)
    assert.equal(existsSync(moved), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
