import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every truncated h1 consumer uses the shared full-identity disclosure', () => {
  const root = join(ROOT, 'src', 'components')
  const paths = (readdirSync(root, { recursive: true }) as string[])
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => join(root, path))
  const headings = paths.flatMap((path) => {
    const source = stripComments(read(path))
    return [...source.matchAll(/<h1\b(?=[^>]*\btruncate\b)[^>]*>[\s\S]*?<\/h1>/g)].map(([heading]) => ({ path, heading }))
  })

  assert.equal(headings.length, 9, 'the consumer enumeration must be reviewed when a truncated h1 is added or removed')
  for (const { path, heading } of headings) {
    assert.match(heading, /identityTitleProps\(/, `${path.replace(ROOT + '/', '')} must expose its full identity through the shared helper`)
  }
})
