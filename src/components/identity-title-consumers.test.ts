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

test('both conversation home breadcrumbs use the bounded identity funnel', () => {
  const source = stripComments(read('src/components/SessionTitleBar.tsx'))
  const breadcrumbs = [...source.matchAll(/<button\b[^>]*onClick=\{\(\) => runOf \? onOpenSchedule\([\s\S]*?<\/button>/g)]
  assert.equal(breadcrumbs.length, 1, 'Routine and Project doors share one renderer')
  for (const [button] of breadcrumbs) {
    assert.match(button, /onOpenProject\(home.id\)/)
    assert.match(button, /runOf \? 'Scheduled run of' : 'In'/)
    assert.match(button, /identityBreadcrumbProps\(/, 'home breadcrumb must be bounded by its identity column')
    assert.match(button, /className=\{IDENTITY_BREADCRUMB_TEXT_CLASS\}/, 'breadcrumb prose must shrink inside its button')
  }
  assert.match(source, /data-identity-header-group className=\{IDENTITY_HEADER_GROUP_CLASS\}/)
  assert.match(source, /data-identity-header-actions className=\{IDENTITY_HEADER_ACTIONS_CLASS\}/)
  assert.match(source, /flex-wrap/)
})
