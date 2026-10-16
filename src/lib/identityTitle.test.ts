import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityTitleProps, identityBreadcrumbProps, IDENTITY_BREADCRUMB_TEXT_CLASS, IDENTITY_HEADER_GROUP_CLASS, IDENTITY_HEADER_ACTIONS_CLASS } from './identityTitle.ts'

test('identity title disclosure carries the complete native title and a rendered marker', () => {
  const title = 'Standup digest from Linear'
  assert.deepEqual(identityTitleProps(title), { title, 'data-identity-title': '' })
})

test('home breadcrumbs retain their full disclosure and shrink within the identity column', () => {
  const props = identityBreadcrumbProps('Open the quarterly readiness routine')
  assert.equal(props.title, 'Open the quarterly readiness routine')
  assert.equal(props['data-identity-breadcrumb'], '')
  for (const token of ['min-w-0', 'max-w-full', 'inline-flex']) assert.ok(props.className.split(' ').includes(token))
  assert.equal(IDENTITY_BREADCRUMB_TEXT_CLASS, 'min-w-0 truncate')
  assert.match(IDENTITY_HEADER_GROUP_CLASS, /flex-\[1_1_12rem\]/)
  assert.match(IDENTITY_HEADER_ACTIONS_CLASS, /shrink-0/)
})
