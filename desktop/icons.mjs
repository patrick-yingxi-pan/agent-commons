import { readFile, writeFile } from 'node:fs/promises'
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

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateDesktopIcons()
