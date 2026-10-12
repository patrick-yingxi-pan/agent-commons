import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./localGitSmoke.mjs', import.meta.url), 'utf8')

test('packaged local Git sends wait for the exact hydrated transcript before composing', () => {
  const start = source.indexOf('async function send(')
  const end = source.indexOf('\nasync function assertModelFiles', start)
  assert.notEqual(start, -1, 'send helper exists')
  assert.notEqual(end, -1, 'send helper has a stable boundary')
  const helper = source.slice(start, end)
  const priorGate = helper.indexOf('await expect(replies).toHaveCount(expectedPreviousReplies,')
  const fill = helper.indexOf('await composer.fill(text)')
  const submit = helper.indexOf("await composer.press('Enter')")
  const nextGate = helper.indexOf('await expect(replies).toHaveCount(expectedPreviousReplies + 1,')

  assert.ok(priorGate >= 0, 'the prior transcript count is an explicit awaited gate')
  assert.ok(fill > priorGate, 'the composer is not filled until prior replies hydrate')
  assert.ok(submit > fill, 'Enter follows the composer fill')
  assert.ok(nextGate > submit, 'the next exact reply count follows submission')
  assert.doesNotMatch(helper, /replies\.count\(/, 'the baseline is not sampled from a possibly unhydrated DOM')
  assert.match(helper, /expectedPreviousReplies \+ 1/, 'the new reply is checked against the explicit baseline')
})

test('packaged local Git sends pin every saved-history baseline across route and relaunch changes', () => {
  const sends = [...source.matchAll(/await send\(run\.page,\s*'([^']+)',\s*'captured-dotfile-v1',\s*(\d+)\)/g)]
    .map(([, prompt, count]) => [prompt, Number(count)])

  assert.deepEqual(sends, [
    ['Read the attached Git snapshot.', 0],
    ['Read the refreshed Git snapshot.', 1],
    ['Read the saved snapshot after local review.', 2],
    ['Read the Git snapshot after relaunch.', 3],
    ['Read the saved Git snapshot without its source.', 4],
    ['Read the saved Git snapshot after disconnect.', 5],
  ], 'each ordinary send states the complete expected prior reply history')
})
