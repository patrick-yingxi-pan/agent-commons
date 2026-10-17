/** The finite reply-stream boundary: chunking may split any frame, malformed
 * noise is ignored, and only message.end proves the logical turn completed. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readReplyEvents } from './replyStream.ts'

const encoder = new TextEncoder()
const streamOf = (...chunks: string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    controller.close()
  },
})

test('a chunk-split finite reply resolves only after dispatching message.end', async () => {
  const seen: string[] = []
  await readReplyEvents(
    streamOf(
      'data: {"type":"message.start","sessionId":"s","message":{"id":"m","role":"assistant","content":""}}\n',
      '\ndata: {"type":"message.end","sessionId":"s","message":{"id":"m","role":"assistant","content":"done"}}\n\n',
    ),
    (event) => seen.push(event.type),
  )
  assert.deepEqual(seen, ['message.start', 'message.end'])
})

test('turn.cancelled is a typed terminal when Stop wins before an assistant message exists', async () => {
  const seen: string[] = []
  await readReplyEvents(
    streamOf(
      'data: {"type":"turn.start","sessionId":"s","turnId":"t"}\n\n',
      'data: {"type":"turn.cancelled","sessionId":"s","turnId":"t"}\n\n',
    ),
    (event) => seen.push(event.type),
  )
  assert.deepEqual(seen, ['turn.start', 'turn.cancelled'])
})

test('EOF without message.end is a retryable interruption, not successful emptiness', async () => {
  await assert.rejects(
    readReplyEvents(
      streamOf('data: {"type":"message.delta","sessionId":"s","messageId":"m","text":"partial"}\n\n'),
      () => {},
    ),
    /interrupted before the reply completed/,
  )
})

test('message.end completes even when the transport would fail immediately afterward', async () => {
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls === 0) {
        pulls += 1
        controller.enqueue(encoder.encode(
          'data: {"type":"message.end","sessionId":"s","message":{"id":"m","role":"assistant","content":"persisted"}}\n\n',
        ))
        return
      }
      controller.error(new Error('post-terminal socket fault'))
    },
  })
  const seen: string[] = []
  await readReplyEvents(body, (event) => seen.push(event.type))
  assert.deepEqual(seen, ['message.end'])
  assert.equal(pulls, 1, 'the decoder never asks the transport for bytes after the terminal frame')
})
