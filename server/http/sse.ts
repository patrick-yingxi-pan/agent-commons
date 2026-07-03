/** Server-Sent Events — the one server→client push primitive. Used for the
 *  ambient `GET /v1/events` stream and (Phase 3) for the streaming reply body of
 *  `POST /v1/sessions/:id/messages`. Plain HTTP, auto-reconnecting, and it
 *  carries our typed `ServerEvent`s as JSON `data:` frames. */
import type { ServerResponse } from 'node:http'
import type { ServerEvent } from '../../contract/index.ts'
import { BASE_HEADERS } from './respond.ts'

export interface SseChannel {
  /** Write one event frame. `id` (when given) becomes the SSE `id:` field — the
   *  browser's `EventSource` remembers it and presents it as `Last-Event-ID` on
   *  reconnect, which is what makes the ambient stream resumable (server/eventlog.ts).
   *  Reply streams don't use it (their resumption is the per-turn `seq` payload). */
  send(event: ServerEvent, id?: number): void
  close(): void
}

/** Promote a response into an SSE channel. */
export function openSse(res: ServerResponse): SseChannel {
  res.writeHead(200, {
    ...BASE_HEADERS, // CORS + security headers (nosniff is the meaningful one for a stream)
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering so events flush immediately (nginx & friends).
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  let open = true
  return {
    send(event, id) {
      if (!open || res.writableEnded) return
      const idLine = id === undefined ? '' : `id: ${id}\n`
      res.write(`${idLine}data: ${JSON.stringify(event)}\n\n`)
    },
    close() {
      if (!open) return
      open = false
      if (!res.writableEnded) res.end()
    },
  }
}
