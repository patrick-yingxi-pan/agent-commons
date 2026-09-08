import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)

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

export function thirdPartyNoticesPlugin(): Plugin {
  return {
    name: 'agent-commons-third-party-notices',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'third-party/pdfjs-dist.txt', source: pdfDependencyNotice() })
    },
  }
}
