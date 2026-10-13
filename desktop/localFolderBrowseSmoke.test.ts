import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

test('packaged local folder browsing is awaited before source-absent relaunch acceptance', () => {
  const driver = readFileSync(new URL('./attachmentSmoke.mjs', import.meta.url), 'utf8')
  const browse = driver.indexOf('await smokeLocalFolderBrowse(')
  const remove = driver.indexOf('await rm(ephemeralFolder, { recursive: true })')
  const restore = driver.indexOf('await verifyLocalFolderBrowseRelaunch(')
  assert.ok(browse >= 0, 'real packaged folder listing/preview/saved-copy walk is awaited')
  assert.ok(remove > browse, 'the fixture source is removed after browsing')
  assert.ok(restore > remove, 'saved-copy equality is checked after source removal and app relaunch')
  assert.equal(ignoreFromPackage('/desktop/localFolderBrowseSmoke.mjs'), true, 'the acceptance driver never ships')
})
