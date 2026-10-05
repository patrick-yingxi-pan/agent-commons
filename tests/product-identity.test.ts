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
