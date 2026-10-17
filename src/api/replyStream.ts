/** Decode the finite SSE document used by send + reattach. A reply stream is
 * successful only when its typed `message.end` or `turn.cancelled` frame
 * arrives; socket EOF by itself is transport failure, never an empty answer. */
import type { ReplyStreamEvent } from '../../contract/index.ts'

export async function readReplyEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ReplyStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))
      if (!line) continue
      let event: ReplyStreamEvent
      try {
        event = JSON.parse(line.slice(5).trim()) as ReplyStreamEvent
      } catch {
        continue
      }
      onEvent(event)
      if (event.type === 'message.end' || event.type === 'turn.cancelled') {
        // The typed terminal frame is the logical boundary. Do not wait for a
        // second transport signal: a later socket fault cannot undo a complete
        // answer or an explicit pre-message cancellation.
        await reader.cancel().catch(() => {})
        return
      }
    }
  }
  throw new Error('Generation was interrupted before the reply completed.')
}
