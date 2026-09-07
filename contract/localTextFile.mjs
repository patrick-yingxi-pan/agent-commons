/** Selected-file intake shared by the browser and unbundled Electron main.
 * Plain JavaScript keeps this policy usable by both runtimes without a loader.
 * This is a read-only preview limit, separate from the smaller model budget. */
export const LOCAL_TEXT_PREVIEW_BYTES = 256 * 1024

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'adoc', 'csv', 'tsv', 'json',
  'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'html', 'htm', 'xml', 'xsl', 'css', 'scss', 'sass', 'less', 'log', 'diff', 'patch',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'py', 'pyi', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift',
  'c', 'h', 'cc', 'hh', 'cpp', 'hpp', 'cxx', 'hxx', 'cs', 'fs', 'fsx', 'm', 'mm',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'sql', 'graphql',
  'gql', 'proto', 'r', 'rmd', 'jl', 'lua', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl',
  'clj', 'cljs', 'cljc', 'edn', 'hs', 'lhs', 'elm', 'dart', 'tex', 'bib',
  'tf', 'tfvars', 'hcl', 'cmake', 'gradle', 'lock',
])
const TEXT_NAMES = new Set([
  'readme', 'license', 'licence', 'copying', 'notice', 'changelog', 'authors',
  'makefile', 'gnumakefile', 'dockerfile', 'containerfile', 'gemfile', 'rakefile',
  'procfile', 'justfile', '.gitignore', '.gitattributes', '.gitmodules',
  '.dockerignore', '.editorconfig', '.npmrc', '.nvmrc', '.env',
])

/** Names select supported text formats; a browser MIME claim cannot turn a
 * PDF, archive, or image into plain text. Actual bytes must also pass decoding. */
export function isLocalTextFileName(name) {
  if (typeof name !== 'string' || !name || /[\\/\0]/.test(name)) return false
  const lower = name.toLowerCase()
  if (TEXT_NAMES.has(lower)) return true
  if (lower.startsWith('.env.') && lower.length > 5) return true
  const dot = lower.lastIndexOf('.')
  return dot > 0 && TEXT_EXTENSIONS.has(lower.slice(dot + 1))
}

/** Whole, strict UTF-8 only. Preserve BOM/line endings exactly; never replace
 * invalid bytes or mistake control-heavy binary content for readable source. */
export function decodeLocalTextPreview(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > LOCAL_TEXT_PREVIEW_BYTES) return undefined
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text) ? undefined : text
  } catch {
    return undefined
  }
}
