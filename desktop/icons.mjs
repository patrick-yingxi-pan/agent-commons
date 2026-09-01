import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import png2icons from 'png2icons'

const PNG = fileURLToPath(new URL('./assets/icon.png', import.meta.url))
const ICNS = fileURLToPath(new URL('./assets/icon.icns', import.meta.url))
const ICO = fileURLToPath(new URL('./assets/icon.ico', import.meta.url))

export async function generateDesktopIcons() {
  const source = await readFile(PNG)
  const icns = png2icons.createICNS(source, png2icons.BICUBIC, 0)
  const ico = png2icons.createICO(source, png2icons.BICUBIC, 0, false, true)
  if (!icns || !ico) throw new Error('The desktop icon encoder refused the 1024px source PNG.')
  await Promise.all([writeFile(ICNS, icns), writeFile(ICO, ico)])
}

/** Electron Packager 20 probes the optional macOS 26 `.icon` format before
 * falling back to `.icns`, so its warning does not prove the actual bundle is
 * unbranded. The artifact does: fail unless the installed macOS resource is
 * byte-for-byte the canonical icon generated immediately before packaging. */
export async function verifyPackagedDesktopIcon({ artifactPath, targetPlatform, sourceIconPath = ICNS }) {
  if (targetPlatform !== 'darwin') return

  const packagedIconPath = join(
    artifactPath,
    'Agent Commons.app',
    'Contents',
    'Resources',
    'electron.icns',
  )
  let source
  let packaged
  try {
    const loaded = await Promise.all([readFile(sourceIconPath), readFile(packagedIconPath)])
    source = loaded[0]
    packaged = loaded[1]
  } catch (cause) {
    throw new Error('Packaged macOS application is missing its canonical Agent Commons icon.', { cause })
  }
  if (source.length === 0 || !source.equals(packaged)) {
    throw new Error('Packaged macOS icon does not match the canonical generated Agent Commons icon.')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateDesktopIcons()
