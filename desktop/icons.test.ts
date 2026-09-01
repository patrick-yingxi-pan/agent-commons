import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verifyPackagedDesktopIcon } from './icons.mjs'

test('macOS packaging proves the embedded icon is the canonical generated asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-icon-artifact-test-'))
  const artifactPath = join(root, 'Agent Commons-darwin-arm64')
  const sourceIconPath = join(root, 'canonical.icns')
  const packagedIconPath = join(
    artifactPath,
    'Agent Commons.app',
    'Contents',
    'Resources',
    'electron.icns',
  )
  await writeFile(sourceIconPath, 'canonical-icon')
  try {
    await assert.rejects(
      verifyPackagedDesktopIcon({ artifactPath, targetPlatform: 'darwin', sourceIconPath }),
      /missing its canonical Agent Commons icon/,
    )

    await mkdir(dirname(packagedIconPath), { recursive: true })
    await writeFile(packagedIconPath, 'default-electron-icon')
    await assert.rejects(
      verifyPackagedDesktopIcon({ artifactPath, targetPlatform: 'darwin', sourceIconPath }),
      /does not match the canonical generated Agent Commons icon/,
    )

    await writeFile(packagedIconPath, 'canonical-icon')
    await verifyPackagedDesktopIcon({ artifactPath, targetPlatform: 'darwin', sourceIconPath })

    await rm(packagedIconPath)
    await verifyPackagedDesktopIcon({ artifactPath, targetPlatform: 'win32', sourceIconPath })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
