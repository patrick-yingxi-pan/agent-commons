import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBody } from './respond.ts'

test('readBody rejects a multi-chunk request as soon as the tail crosses its budget', async () => {
  const first = Buffer.from('{"payload":"' + 'a'.repeat(1024 * 1024 - 20))
  const tail = Buffer.from('a'.repeat(64) + '"}')
  const request = {
    on(event: string, callback: (chunk?: Uint8Array) => void) {
      if (event === 'data') { callback(first); callback(tail) }
      if (event === 'end') queueMicrotask(() => callback())
      return request
    },
  }
  await assert.rejects(() => readBody(request as never), /too large/)
})
