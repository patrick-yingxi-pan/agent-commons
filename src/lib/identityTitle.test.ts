import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityTitleProps } from './identityTitle.ts'

test('identity title disclosure carries the complete native title and a rendered marker', () => {
  const title = 'Standup digest from Linear'
  assert.deepEqual(identityTitleProps(title), { title, 'data-identity-title': '' })
})
