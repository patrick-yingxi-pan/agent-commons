import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function packageNotice(packageName: string, fallbackLicense?: string): string {
  const root = dirname(require.resolve(`${packageName}/package.json`))
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const license = fallbackLicense ?? readFileSync(join(root, 'LICENSE'), 'utf8')
  return `${manifest.name} ${manifest.version}\n\n${license}`
}

/** The renderer-only PDF dependency is absent from packaged node_modules, and
 * minification can discard its notice. Carry the exact installed license and
 * upstream notice in dist so both the web and desktop distributions retain it. */
export function pdfDependencyNotice(): string {
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const source = readFileSync(join(root, 'build/pdf.mjs'), 'utf8')
  const notice = source.match(/^\/\*\*[\s\S]*?@licend[\s\S]*?\*\//)?.[0]
  if (!notice) throw new Error('PDF.js distribution notice is missing.')
  return `${manifest.name} ${manifest.version}\n\n${notice}\n\n${readFileSync(join(root, 'LICENSE'), 'utf8')}`
}

export function zipDependencyNotice(): string {
  return packageNotice('@zip.js/zip.js')
}

/** saxes 6.0.0's npm tarball omits LICENSE. This exact upstream text was
 * vendored from https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE;
 * refuse future versions rather than silently shipping stale legal text. */
export function saxesDependencyNotice(): string {
  const root = dirname(require.resolve('saxes/package.json'))
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (manifest.version !== '6.0.0') throw new Error(`Unsupported saxes version for vendored license: ${manifest.version}`)
  return `${manifest.name} ${manifest.version}\n\n${readFileSync(join(repoRoot, 'docs/third-party/saxes-6.0.0.txt'), 'utf8')}`
}

export function xmlcharsDependencyNotice(): string {
  return packageNotice('xmlchars')
}

export function thirdPartyNoticesPlugin(): Plugin {
  return {
    name: 'agent-commons-third-party-notices',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'third-party/pdfjs-dist.txt', source: pdfDependencyNotice() })
      this.emitFile({ type: 'asset', fileName: 'third-party/@zip.js-zip.js.txt', source: zipDependencyNotice() })
      this.emitFile({ type: 'asset', fileName: 'third-party/saxes.txt', source: saxesDependencyNotice() })
      this.emitFile({ type: 'asset', fileName: 'third-party/xmlchars.txt', source: xmlcharsDependencyNotice() })
    },
  }
}
