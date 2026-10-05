/** A reply observer holds current read authority, not a permanent capability
 * obtained when its socket opened. Closing a view never cancels generation. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openSse } from '../http/sse.ts'
import { sendError } from '../http/respond.ts'
import { store } from '../store/index.ts'
import { turns, type TurnFrame } from '../turns.ts'

export function serveSessionTurn(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  turnId: string,
  tenantId: string,
  after: number,
): void {
  const canRead = () => {
    const session = store.getSession(sessionId)
    return !!session && store.sessionVisibleToTenant(session, tenantId)
  }
  const turn = turns.get(turnId)
  if (!canRead() || !turn || turn.sessionId !== sessionId) {
    sendError(res, 'not_found', 'No readable live turn on this conversation.')
    return
  }

  const channel = openSse(res)
  let closed = false
  let detachTurn = () => {}
  let detachAuthority = () => {}
  let detachFault = () => {}
  const close = () => {
    if (closed) return
    closed = true
    detachTurn()
    detachAuthority()
    detachFault()
    channel.close()
  }
  const sendFrame = (frame: TurnFrame) => {
    if (closed) return
    if (!canRead()) return close()
    channel.send(frame.event.type === 'message.delta' ? { ...frame.event, seq: frame.seq } : frame.event)
  }
  const attachment = turns.attach(turnId, after, (frame) => {
    if (frame) sendFrame(frame)
    else close()
  })
  if (!attachment) return close()
  detachTurn = attachment.unsubscribe
  // Authority changes can arrive between frames (or during replay). Withdraw
  // immediately, and never revive this socket after a later grant restoration.
  detachAuthority = store.subscribe(() => { if (!canRead()) close() })
  detachFault = store.subscribePersistenceFault(close)
  req.on('close', close)
  res.on('close', close)
  for (const frame of attachment.replay) sendFrame(frame)
}
