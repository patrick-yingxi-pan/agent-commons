import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gitWorkingMode } from './gitWorkingMode.mjs'

test('Git working mode uses only the regular file owner executable bit', () => {
  for (const [mode, expected] of [[0o100644, '100644'], [0o100755, '100755'], [0o100654, '100644'], [0o100700, '100755']]) {
    assert.equal(gitWorkingMode({ status: 'file', version: `1:2:${mode}:3:4:5:6:7` }), expected)
  }
  for (const version of ['1:2:0:3:4:5:6:7', `1:2:${0o120755}:3:4:5:6:7`, '1:2:999999:3:4:5:6:7', '1:2:33188', undefined]) {
    assert.throws(() => gitWorkingMode({ status: 'file', version }))
  }
  assert.throws(() => gitWorkingMode({ status: 'unsupported', version: `1:2:${0o100644}:3:4:5:6:7` }))
})
