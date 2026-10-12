import { fileURLToPath } from 'node:url'

export const DESKTOP_PRODUCT_NAME = 'Agent Commons'
export const DESKTOP_BUNDLE_ID = 'com.agentcommons.desktop'

const SHIPPED_ROOTS = new Set(['contract', 'connector', 'desktop', 'dist', 'node_modules', 'scripts', 'server'])
const DESKTOP_RUNTIME_PACKAGES = new Set([
  '@anthropic-ai/sdk',
  '@zip.js/zip.js',
  'ajv',
  'fast-deep-equal',
  'fast-uri',
  'json-schema-traverse',
  'require-from-string',
  '@babel/runtime',
  '@stablelib/base64',
  'fast-sha256',
  'json-schema-to-ts',
  'standardwebhooks',
  'ts-algebra',
])

function nodeModuleName(path) {
  const parts = path.split('/')
  const at = parts.lastIndexOf('node_modules')
  if (at < 0 || !parts[at + 1]) return null
  const first = parts[at + 1]
  if (first.startsWith('@')) return parts[at + 2] ? `${first}/${parts[at + 2]}` : first
  return first
}

/** Electron Packager visits paths with a leading slash. Keep the artifact to
 * executable runtime inputs: no docs, fixtures, source UI, or test evidence. */
export function ignoreFromPackage(path) {
  if (!path) return false
  const normalized = path.replaceAll('\\', '/').replace(/^\//, '')
  if (!normalized) return false
  const [root] = normalized.split('/')
  if (['package.json', 'LICENSE'].includes(normalized)) return false
  if (!SHIPPED_ROOTS.has(root)) return true
  // Packager stops traversing a directory as soon as its parent is ignored.
  // Root allowlisting therefore has to keep the directory node itself before
  // applying the more selective descendant rules below.
  if (normalized === root) return false
  if (root === 'node_modules') {
    const moduleName = nodeModuleName(normalized)
    if (!moduleName) return false
    if (moduleName.startsWith('@') && !moduleName.includes('/')) {
      return ![...DESKTOP_RUNTIME_PACKAGES].some((name) => name.startsWith(`${moduleName}/`))
    }
    return !DESKTOP_RUNTIME_PACKAGES.has(moduleName)
  }
  if (/\.test\.[cm]?[jt]sx?$/.test(normalized) || /(^|\/)(CLAUDE|AGENTS|SPEC)\.md$/.test(normalized)) return true
  if (
    normalized === 'desktop/assets' ||
    normalized.startsWith('desktop/assets/') ||
    normalized === 'desktop/native' ||
    normalized.startsWith('desktop/native/') ||
    normalized === 'desktop/bin' ||
    normalized.startsWith('desktop/bin/') ||
    normalized === 'desktop/entitlements.mac.plist' ||
    normalized === 'desktop/entitlements.git.plist' ||
    normalized === 'desktop/entitlements.pdf-ocr.plist' ||
    [
      'desktop/dev.mjs',
      'desktop/icons.mjs',
      'desktop/package.mjs',
      'desktop/packager.config.mjs',
      'desktop/profileHelperBuild.mjs',
      'desktop/gitFileBuild.mjs',
      'desktop/gitFileTestFixture.mjs',
      'desktop/ocrHelperBuild.mjs',
      'desktop/imageOcrFixture.mjs',
      'desktop/imageOcrSmoke.mjs',
      'desktop/pdfOcrHelperBuild.mjs',
      'desktop/pdfOcrFixture.mjs',
      'desktop/pdfOcrSmoke.mjs',
      'desktop/artifactPdfOcrSmoke.mjs',
      'desktop/nativeBuild.mjs',
      'desktop/bundledGitBuild.mjs',
      'desktop/bundledGitSmoke.mjs',
      'desktop/release-plan.mjs',
      'desktop/release-publish.mjs',
      'desktop/release-set.mjs',
      'desktop/release.mjs',
      'desktop/updateFeed.mjs',
      'desktop/updateMenuSmoke.mjs',
      'desktop/smoke.mjs',
      'desktop/smokePaths.mjs',
      'desktop/profileAdmissionSmoke.mjs',
      'desktop/startupSmokeInspector.mjs',
      'desktop/mcpCredentialSmoke.mjs',
      'desktop/mcpSchemaSmoke.mjs',
      'desktop/attachmentSmoke.mjs',
      'desktop/localGitSmoke.mjs',
      'desktop/attachmentSmokeFixture.mjs',
      'desktop/artifactImageImportSmoke.mjs',
      'desktop/contributionReviewSmoke.mjs',
      'desktop/dispatchSmoke.mjs',
      'desktop/dispatchSmokeFixture.mjs',
      'desktop/contributionMcpSmokeFixture.mjs',
      'desktop/contributionMcpSmoke.mjs',
      'desktop/routineMcpSmoke.mjs',
      'desktop/routineMcpLocalSmoke.mjs',
      'desktop/routineMcpLocalSmokePeer.mjs',
      'desktop/routineMcpLocalRestoreFixture.mjs',
      'desktop/routineMcpSmokeFixture.mjs',
      'desktop/routineMessagesSmokeFixture.mjs',
      'desktop/commissionMcpSmoke.mjs',
      'desktop/commissionMessagesSmokeFixture.mjs',
      'desktop/mcpLoopbackSmokePackage.mjs',
      'desktop/mcpOAuthSmoke.mjs',
      'desktop/mcpOAuthSmokeFixture.mjs',
      'desktop/mcpOAuthMessagesSmokeFixture.mjs',
      'desktop/mcpOAuthRoutineMessagesSmokeFixture.mjs',
      'desktop/mcpStdioSmoke.mjs',
      'desktop/mcpStdioSmokePeer.mjs',
      'desktop/contributionStdioSmoke.mjs',
      'desktop/discussionContextSmoke.mjs',
      'desktop/artifactContextSmoke.mjs',
      'desktop/artifactHistorySmoke.mjs',
      'desktop/artifactSearchSmoke.mjs',
      'desktop/conversationSearchSmoke.mjs',
      'desktop/artifactDocumentEditSmoke.mjs',
      'desktop/artifactDocumentMigrationFixture.mjs',
      'desktop/contributionReviewSmokeFixture.mjs',
      'desktop/artifactSheetImportSmoke.mjs',
      'desktop/restoreSmoke.mjs',
    ].includes(normalized)
  ) return true
  if (root === 'scripts' && normalized !== 'scripts/start.mjs') return true
  return false
}

export default {
  name: DESKTOP_PRODUCT_NAME,
  executableName: DESKTOP_PRODUCT_NAME,
  appBundleId: DESKTOP_BUNDLE_ID,
  appCategoryType: 'public.app-category.productivity',
  icon: fileURLToPath(new URL('./assets/icon', import.meta.url)),
  asar: true,
  // A runtime allowlist is stricter than package-manager pruning: frontend
  // dependencies are build inputs. The server's SDK closure and the bounded
  // values-only Office ZIP writer and isolated schema validator belong in the
  // installed application; no renderer imports the validator.
  prune: false,
  ignore: ignoreFromPackage,
  extendInfo: {
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    },
    NSCameraUsageDescription: 'Agent Commons does not request camera access.',
    NSMicrophoneUsageDescription: 'Agent Commons does not request microphone access.',
    NSAudioCaptureUsageDescription: 'Agent Commons does not request audio capture access.',
    NSBluetoothAlwaysUsageDescription: 'Agent Commons does not request Bluetooth access.',
    NSBluetoothPeripheralUsageDescription: 'Agent Commons does not request Bluetooth access.',
  },
}
