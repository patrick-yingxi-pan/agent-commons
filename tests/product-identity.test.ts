/** ── Locking test: active product identity has one current story ────────────
 *
 * Agent Commons has one product story across package metadata, browser and
 * sign-in surfaces, repository context, contract comments, seed data, and
 * documentation. Retired product framing must not return through any of those
 * doors.
 *
 * This lock scans the shipped source and repository documentation for the exact
 * legacy vocabulary. It deliberately does not ban the noun `proposal`: change
 * proposals and consent proposals are live product entities. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { ROOT } from './helpers/source.ts'

const TEXT_EXTENSIONS = ['.md', '.ts', '.tsx', '.json', '.html', '.mjs', '.css']
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', '.data', 'test-results', 'out', 'playwright-report'])
const LEGACY = [
  /UI\/UX proposal/i,
  /written proposal/i,
  /independent UI proposal/i,
  /not affiliated with or endorsed by Anthropic/i,
  /Chat\s*[,/]\s*Cowork\s*[,/]\s*(?:and\s+)?Code/i,
  /three[- ]tabs?\b/i,
  /\bPROPOSAL(?:\.md|\s+§)/i,
  /(?:docs\/)?evaluation\.md/i,
  /claude-ui-proposal/i,
  /Sign in to Claude/i,
  /New to Claude/i,
  /proposal to Anthropic/i,
  /share this with Anthropic/i,
]

test('AGPLv3 license text, metadata, and contribution policy stay aligned', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
  assert.equal(pkg.license, 'AGPL-3.0-only')
  assert.equal(lock.packages[''].license, pkg.license)
  // SPDX's verbatim AGPL-3.0-only text, with line endings normalized for Windows.
  // This detects missing clauses or accidental edits to the legal instrument.
  const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8').replaceAll('\r\n', '\n')
  assert.equal(createHash('sha256').update(license).digest('hex'),
    'd8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee')
  const notice = readFileSync(join(ROOT, 'LICENSING.md'), 'utf8')
  assert.match(notice, /Copyright \(c\) 2026 Patrick Pan/)
  assert.match(notice, /AGPL-3\.0-only/)
  assert.match(notice, /\]\(LICENSE\)/)
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /\]\(LICENSING\.md\)/)
  assert.match(readme, /\]\(CONTRIBUTING\.md\)/)
  const contributions = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8').replace(/\s+/g, ' ')
  assert.match(readme.replace(/\s+/g, ' '), /Commercial use, including paid hosting, is allowed under the AGPL\./)
  assert.match(notice.replace(/\s+/g, ' '), /The project offers no separate proprietary licensing option\./)
  assert.match(contributions, /By submitting a contribution, you agree to license your original contribution under AGPLv3 only \(`AGPL-3\.0-only`\)\./)
  assert.match(contributions, /Contributors retain their copyrights\./)
  assert.match(contributions, /No separate contributor agreement or copyright assignment is required\./)
  for (const [file, text] of Object.entries({ 'README.md': readme, 'LICENSING.md': notice, 'CONTRIBUTING.md': contributions })) {
    assert.doesNotMatch(text.replace(/\s+/g, ' '), /separate paid commercial|optional paid commercial|both licensing options|dual-licensing model|commercial-license inquiry/i,
      `${file} must not restore the separate commercial licensing program`)
  }
})

function repositoryTextFiles(root = ROOT, readDirectory: (path: string, options: { withFileTypes: true }) => Dirent[] = readdirSync): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readDirectory(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        if (entry.name === 'worktrees' && basename(directory) === '.claude') continue
        visit(join(directory, entry.name))
        continue
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
      const file = relative(root, join(directory, entry.name)).split(sep).join('/')
      if (file !== 'tests/product-identity.test.ts') files.push(file)
    }
  }
  visit(root)
  return files
}

test('Agent Commons is not framed as the retired Claude UI proposal', () => {
  assert.equal(existsSync(join(ROOT, 'PROPOSAL.md')), false, 'the retired proposal document must stay removed')
  assert.equal(existsSync(join(ROOT, 'docs', 'evaluation.md')), false, 'the retired evaluator guide must stay removed')

  const offenders: string[] = []
  const files = repositoryTextFiles()
  assert.ok(files.length > 100, `found only ${files.length} text files — the identity scan has lost its subject`)
  for (const file of files) {
    const body = readFileSync(join(ROOT, file), 'utf8')
    for (const pattern of LEGACY) {
      const match = pattern.exec(body)
      if (match) offenders.push(`${file}: ${match[0]}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `active source or documentation restored the retired UI-proposal framing:\n${offenders.join('\n')}`,
  )
})

test('identity scan prunes generated directories before reading them and includes nested source', () => {
  const root = mkdtempSync(join(tmpdir(), 'product-identity-scan-'))
  try {
    mkdirSync(join(root, 'src', 'nested'), { recursive: true })
    mkdirSync(join(root, 'test-results', 'shard-0'), { recursive: true })
    mkdirSync(join(root, '.claude', 'worktrees', 'checkout'), { recursive: true })
    writeFileSync(join(root, 'src', 'nested', 'active.ts'), 'Agent Commons')
    writeFileSync(join(root, 'test-results', 'shard-0', 'trace.ts'), 'ignored')
    writeFileSync(join(root, '.claude', 'worktrees', 'checkout', 'stale.ts'), 'ignored')

    const visited: string[] = []
    const files = repositoryTextFiles(root, (directory, options) => {
      visited.push(relative(root, directory).split(sep).join('/') || '.')
      return readdirSync(directory, options)
    })
    assert.deepEqual(files, ['src/nested/active.ts'])
    assert.deepEqual(visited.sort(), ['.', '.claude', 'src', 'src/nested'])
    assert.ok(!visited.some((directory) => directory.startsWith('test-results')))
    assert.ok(!visited.some((directory) => directory.startsWith('.claude/worktrees')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('package, browser, and sign-in surfaces name the collaboration platform', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; description: string }
  assert.equal(pkg.name, 'agent-commons')
  assert.match(pkg.description, /collaboration platform for people and agents/i)

  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  assert.match(html, /<title>Agent Commons<\/title>/)
  const auth = readFileSync(join(ROOT, 'src', 'components', 'auth', 'AuthScreen.tsx'), 'utf8')
  assert.match(auth, /Sign in to Agent Commons/)
  assert.match(auth, /New to Agent Commons/)
})
