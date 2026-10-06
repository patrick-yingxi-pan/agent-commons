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

test('an explicit 16 MiB route budget accepts a body over 8 MiB while the default remains 1 MiB', async () => {
  const json = JSON.stringify({ payload: 'x'.repeat(8 * 1024 * 1024 + 1) })
  const request = () => {
    const bytes = Buffer.from(json)
    const req = {
      on(event: string, callback: (chunk?: Uint8Array) => void) {
        if (event === 'data') callback(bytes)
        if (event === 'end') queueMicrotask(() => callback())
        return req
      },
    }
    return req
  }

  await assert.rejects(() => readBody(request() as never), /too large/, 'ordinary routes retain their 1 MiB default')
  const parsed = await readBody<{ payload: string }>(request() as never, { maxBytes: 16 * 1024 * 1024 })
  assert.equal(parsed.payload.length, 8 * 1024 * 1024 + 1)
})
