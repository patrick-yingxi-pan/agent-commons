import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('navigation revelation survives focus consumption without writing the global fold preference', () => {
  const section = read('./ResourcePage.tsx')
  const artifact = read('./artifactPreview.tsx')
  assert.match(section, /useEffect\(\(\) => \{ if \(reveal\) setRevealed\(true\) \}, \[reveal\]\)/)
  assert.match(section, /const folded = reveal \|\| revealed \? false : persist \? storedFolded : localFolded/)
  assert.match(section, /setRevealed\(false\)\s+if \(persist\) setStoredFolded\(next\)/)
  assert.match(artifact, /<Section\s+key=\{artifact\.id\}\s+title="Content"/)
  assert.match(artifact, /reveal=\{pendingFocus\?\.artifactBlockId !== undefined\}/)
})
