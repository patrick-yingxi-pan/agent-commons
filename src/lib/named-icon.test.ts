import { test } from 'node:test'
import assert from 'node:assert/strict'
import { namedIconProps } from './namedIcon.ts'

test('meaningful glyphs receive an image role and their accessible name together', () => {
  assert.deepEqual(namedIconProps('New session'), { role: 'img', 'aria-label': 'New session' })
})
