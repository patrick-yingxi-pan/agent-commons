import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SavedContext } from '../../contract/contexts.ts'
import { resolveSavedContext } from './savedContextIdentity.ts'

const fixture = { id: 'mcp-linear', label: 'Shared label', kind: 'mcp' } as SavedContext
const external = { ...fixture, id: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }

test('opaque project source identity wins over same-label registry entries', () => {
  assert.equal(resolveSavedContext([fixture, external], external.label, external.id), external)
  assert.equal(resolveSavedContext([fixture], external.label, external.id), undefined,
    'a missing source must not silently switch to the same-label fixture')
})

test('legacy registry doors prefer exact identity and refuse ambiguous labels', () => {
  assert.equal(resolveSavedContext([fixture, external], fixture.id.toUpperCase()), fixture)
  assert.equal(resolveSavedContext([fixture], ' shared LABEL '), fixture)
  assert.equal(resolveSavedContext([fixture, external], external.label), undefined)
  assert.equal(resolveSavedContext([fixture], 'not saved'), undefined)
})
