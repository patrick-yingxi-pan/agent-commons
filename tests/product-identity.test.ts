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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './helpers/source.ts'

const TEXT_EXTENSIONS = ['.md', '.ts', '.tsx', '.json', '.html', '.mjs', '.css']
const SKIP = /(^|[\\/])(?:\.git|node_modules|dist|\.data|\.claude[\\/]worktrees)(?:[\\/]|$)/
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

function repositoryTextFiles(): string[] {
  const files = readdirSync(ROOT, { recursive: true })
    .map(String)
    .map((file) => file.split('\\').join('/'))
    .filter((file) => TEXT_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .filter((file) => !SKIP.test(file))
    .filter((file) => file !== 'tests/product-identity.test.ts')
  assert.ok(files.length > 100, `found only ${files.length} text files — the identity scan has lost its subject`)
  return files
}

test('Agent Commons is not framed as the retired Claude UI proposal', () => {
  assert.equal(existsSync(join(ROOT, 'PROPOSAL.md')), false, 'the retired proposal document must stay removed')
  assert.equal(existsSync(join(ROOT, 'docs', 'evaluation.md')), false, 'the retired evaluator guide must stay removed')

  const offenders: string[] = []
  for (const file of repositoryTextFiles()) {
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
