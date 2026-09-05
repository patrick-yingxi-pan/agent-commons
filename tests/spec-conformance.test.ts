/** Spec ⇄ code drift guard (docs/spec/). The behavioral conformance run is
 *  `node --test` itself — every ✅ requirement names a locking test that fails on a
 *  regression. This meta-test guards the *other* failure modes: the spec rotting
 *  against the tree, and the spec quietly under-covering what's built.
 *
 *  It checks: (1) every repo path the spec references in backticks exists;
 *  (2) every requirement id is unique; (3) every row carries a status; (4) every
 *  ✅ row cites a test or is marked in-app (no silent ✅); (5) every server route
 *  is mentioned somewhere in the spec (inverse coverage — a built endpoint with
 *  no requirement fails); (6) every 📝 "not built" requirement is surfaced in
 *  the README Known-gaps list;
 *  plus the two structural invariants the spec claims (INV-1, INV-3).
 *
 *  It does NOT prove a named test truly exercises its requirement — that's the
 *  author's discipline. It makes a broken reference, an unverified ✅, an unspecced
 *  endpoint, or a hidden gap fail loudly. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, read, filesUnder, concatSource } from './helpers/source.ts'

const STATUS_GLYPHS = ['✅', '🟡', '🧭', '📝']

/** Module-local requirement tables — a `SPEC.md` beside the code it governs.
 *
 *  These MUST be scanned here. When the persistence rows moved out of
 *  `docs/spec/07` and into `server/persistence/SPEC.md` (colocation, 2026-08-12)
 *  they left this file's reach entirely: six ✅ rows stopped being checked for a
 *  status glyph, for a locking-test citation, and for path rot — silently, with
 *  the pillar still green because it no longer had rows to be wrong about. A
 *  ledger whose oracle does not follow its rows is not a ledger.
 *
 *  Walked directly rather than through `filesUnder`, which THROWS on a tree
 *  that matches nothing — the right guard for a source scan (a scan over
 *  nothing passes vacuously) and the wrong one here, where "this layer has no
 *  SPEC.md" is a legitimate state. Routed through it, dropping the last
 *  markdown file from `contract/` would kill this suite with a vacuity error
 *  about the wrong subject. */
const moduleSpecFiles = () => {
  const out = []
  for (const dir of ['contract', 'server', 'src']) {
    if (!existsSync(join(ROOT, dir))) continue
    for (const f of readdirSync(join(ROOT, dir), { recursive: true })) {
      const p = String(f).split('\\').join('/')
      if (p.endsWith('SPEC.md')) out.push(join(ROOT, dir, p))
    }
  }
  return out
}

const specFiles = () => [...filesUnder('docs/spec', ['.md']), ...moduleSpecFiles()]
const pillarFiles = () => specFiles().filter((f) => !f.endsWith('README.md'))
const rel = (f) => f.slice(ROOT.length + 1)

/** Table rows whose first cell is a requirement id (ADAPT-1, CTX-FS-1, BROKER-EXP-1,
 *  FWD-1, MOCK-2, …). Skips header / separator / legend / pillar-list rows. */
function requirementRows(markdown) {
  const rows = []
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 2) continue
    if (/^[A-Z][A-Z-]*-\w+$/.test(cells[0])) rows.push({ id: cells[0], cells, text: cells.join(' ') })
  }
  return rows
}

/** Inline-code tokens that look like a repo path (dir-prefixed or a known root file);
 *  excludes globs/URLs/flags and strips a trailing :line. */
const DIR_PREFIX = /^(contract|server|src|tests|scripts|docs|e2e|sample-cloud|sample-runner-host)\//
const ROOT_FILES = new Set(['vite.config.ts', 'package.json', 'tsconfig.json'])
function repoPathsIn(markdown) {
  const out = []
  for (const m of markdown.matchAll(/`([^`]+)`/g)) {
    const token = m[1].trim().replace(/:\d+(-\d+)?$/, '').replace(/\/$/, '')
    if (/[\s*?=()]/.test(token)) continue
    if (DIR_PREFIX.test(token) || ROOT_FILES.has(token)) out.push(token)
  }
  return out
}

test('every repo path referenced in the spec exists on disk', () => {
  const files = specFiles()
  assert.ok(files.length >= 8, 'expected the spec pillar files to be present')
  assert.ok(moduleSpecFiles().length >= 1, 'expected at least one module-local SPEC.md to be in scope')
  const missing = []
  for (const file of files) {
    for (const ref of repoPathsIn(read(file))) {
      // Repo-root paths, in a module SPEC.md exactly as in a pillar. The file
      // is local because it SITS beside its code; the paths inside it do not
      // also have to be relative, and making them relative put them OUTSIDE
      // `repoPathsIn` — a bare `persist.ts` is not dir-prefixed, so it was
      // collected by nothing and could rot freely. One convention, one check.
      if (!existsSync(join(ROOT, ref))) missing.push(`${rel(file)} → \`${ref}\``)
    }
  }
  assert.deepEqual(missing, [], `spec references point at missing paths:\n${missing.join('\n')}`)
})

test('every requirement id names exactly one spec row', () => {
  const owners = new Map()
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const locations = owners.get(row.id) ?? []
      locations.push(rel(file))
      owners.set(row.id, locations)
    }
  }
  const duplicates = [...owners]
    .filter(([, locations]) => locations.length > 1)
    .map(([id, locations]) => `${id}: ${locations.join(', ')}`)
  assert.deepEqual(duplicates, [], `requirement ids must be globally unique:\n${duplicates.join('\n')}`)
})

test('every requirement row carries a status from the legend', () => {
  const bad = []
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const statusCell = row.cells[row.cells.length - 1]
      if (!STATUS_GLYPHS.some((g) => statusCell.includes(g))) bad.push(`${rel(file)} ${row.id}: "${statusCell}"`)
    }
  }
  assert.deepEqual(bad, [], `requirement rows missing a status glyph:\n${bad.join('\n')}`)
})

test('every ✅ requirement cites a locking test or is marked in-app (no silent ✅)', () => {
  const unverified = []
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const statusCell = row.cells[row.cells.length - 1]
      if (!statusCell.includes('✅')) continue
      // What makes a row verified is that it NAMES a locking suite — not that
      // the suite lives in a particular directory. This read `tests/`, which
      // stopped meaning "a test" the moment suites colocated with the code they
      // lock: every server row would have gone quietly unverified while the
      // suite that locks it ran and passed a directory away.
      if (!/\.(test|spec)\.ts/.test(row.text) && !/in-app/i.test(row.text)) unverified.push(`${rel(file)} ${row.id}`)
    }
  }
  assert.deepEqual(unverified, [], `✅ rows with no test / in-app verification:\n${unverified.join('\n')}`)
})

test('inverse coverage: every server route is mentioned in the spec', () => {
  // Routes register in routes/index.ts (as `r.<method>`) and in server/mcp.ts
  // (the MCP door registers on the same table as `router.<method>`) — read
  // both, so a route added through either home still needs its spec row.
  const routes = read(join(ROOT, 'server/routes/index.ts')) + read(join(ROOT, 'server/mcp.ts'))
  const segments = new Set()
  for (const m of routes.matchAll(/\b(?:r|router)\.(?:get|post|patch|delete)\(\s*'\/([a-z0-9-]+)/g)) segments.add(m[1])
  const specText = specFiles().map(read).join('\n').toLowerCase()
  const uncovered = [...segments].filter((s) => !specText.includes(s))
  assert.deepEqual(uncovered, [], `built routes with no spec mention (add a requirement row):\n${uncovered.join(', ')}`)
})

test('every 📝 (not-built) requirement is surfaced in the README Known-gaps list', () => {
  const readme = read(join(ROOT, 'docs/spec/README.md'))
  const unlisted = []
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const statusCell = row.cells[row.cells.length - 1]
      if (statusCell.includes('📝') && !readme.includes(row.id)) unlisted.push(`${rel(file)} ${row.id}`)
    }
  }
  assert.deepEqual(unlisted, [], `📝 requirements not surfaced in README Known-gaps:\n${unlisted.join('\n')}`)
})

test('INV-1: theming through tokens — no `dark:` variants anywhere in src', () => {
  const src = concatSource('src', ['.ts', '.tsx', '.css'])
  assert.ok(!/\bdark:/.test(src), 'found a `dark:` variant — dark mode is the [data-theme="dark"] token block in index.css, never per-component variants (INV-1)')
})

test('INV-1: no raw chromatic Tailwind palette classes — status cues use the ok/warn/danger tokens', () => {
  const code = concatSource('src', ['.ts', '.tsx'])
  const raw = code.match(
    /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|shadow|accent|caret)-(?:emerald|amber|red|rose|orange|yellow|lime|green|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|gray|slate|zinc|neutral|stone)-\d+/g,
  )
  assert.deepEqual(raw ?? [], [], 'raw palette classes bypass the theme tokens (INV-1) — map onto ok/warn/danger (or add a token)')
})

test('INV-1: the dark block redefines every `--color-*` token @theme declares', () => {
  const css = read(join(ROOT, 'src/index.css'))
  const themeBlock = css.match(/@theme \{([\s\S]*?)\n\}/)?.[1]
  const darkBlock = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(themeBlock, 'index.css must declare tokens in an @theme block')
  assert.ok(darkBlock, 'index.css must carry the :root[data-theme="dark"] override block (INV-1)')
  const tokens = [...new Set([...themeBlock.matchAll(/--color-[\w-]+(?=:)/g)].map((m) => m[0]))]
  const missing = tokens.filter((t) => !new RegExp(`${t}:`).test(darkBlock))
  assert.deepEqual(missing, [], `dark block misses token(s) — a theme-invariant value must still be stated explicitly:\n${missing.join(', ')}`)
})

test('INV-1: runtime recipes are the only palette registry and CSS fallback matches default', async () => {
  const { PALETTE_TOKENS, DEFAULT_PALETTE, deriveThemeTokens, paletteById } = await import('../src/lib/theme.ts')
  const css = read(join(ROOT, 'src/index.css'))
  const valueOf = (block, token) => block.match(new RegExp(`${token}: *([^;\\n]+)`))?.[1]?.trim()
  const themeBlock = css.match(/@theme \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const darkBlock = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.ok(!/:root\[data-palette=/.test(css), 'CSS must not grow sealed per-palette blocks beside the recipe registry')

  const recipe = paletteById(DEFAULT_PALETTE).recipe
  for (const [mode, block] of [['light', themeBlock], ['dark', darkBlock]]) {
    const expected = deriveThemeTokens(recipe, mode)
    for (const token of PALETTE_TOKENS) {
      assert.equal(valueOf(block, token), expected[token], `${mode} fallback matches derived ${DEFAULT_PALETTE} ${token}`)
    }
  }
})

test('INV-3: the dev server binds IPv4 (127.0.0.1)', () => {
  const vite = read(join(ROOT, 'vite.config.ts'))
  assert.ok(vite.includes('127.0.0.1'), 'vite.config.ts must bind 127.0.0.1 (INV-3)')
})

/** FWD-8's lock: the claim "server/ is typechecked" is only true while `server`
 *  sits in the tsconfig include, and nothing else would notice its removal —
 *  `npm run typecheck` would simply pass, faster and emptier, exactly as it did
 *  before this was closed. */
test('INV: `npm run typecheck` covers server/ — the backend is not exempt from the contract', () => {
  const tsconfig = JSON.parse(read(join(ROOT, 'tsconfig.json'))) as { include?: string[] }
  assert.ok(
    (tsconfig.include ?? []).includes('server'),
    'tsconfig `include` must list `server` — a backend type error otherwise surfaces at runtime, not at build',
  )
  const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as { scripts: Record<string, string> }
  assert.match(pkg.scripts.typecheck ?? '', /tsc\s+--noEmit/, 'typecheck still runs tsc over that config')
})
