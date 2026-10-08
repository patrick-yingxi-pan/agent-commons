import { useEffect, useRef, useState } from 'react'
import { AccountSwitchedError, ApiRequestError, accountGeneration, onAccountSwitch } from '../api'
import { readConversationExport } from '../api/conversationExport.ts'
import { decodeConversationExport } from '../lib/conversationExport.ts'
import { downloadBlob } from '../lib/downloadText.ts'

type Notice = { tone: 'status' | 'alert'; message: string }

/** One current-account, fresh read; dismissal retires the entire operation. */
export function useConversationDownload(sessionId: string) {
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => {
    setBusy(false)
    setNotice(null)
    return () => { active.current?.abort(); active.current = null }
  }, [sessionId])
  useEffect(() => onAccountSwitch(() => {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setNotice(null)
  }), [])

  const download = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const issuedGeneration = accountGeneration()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
    setBusy(true)
    setNotice(null)
    try {
      const file = await readConversationExport(sessionId, controller.signal)
      if (controller.signal.aborted || active.current !== controller || accountGeneration() !== issuedGeneration) return
      downloadBlob(decodeConversationExport(file, sessionId))
      setNotice({ tone: 'status', message: 'Markdown download requested. It contains the latest saved conversation text.' })
    } catch (error) {
      if (active.current !== controller || error instanceof AccountSwitchedError) return
      const message = timedOut ? 'The download request timed out. Try again.'
        : error instanceof ApiRequestError && error.status === 404 ? 'This conversation is no longer available to this account.'
        : error instanceof ApiRequestError && error.status === 409 ? 'Wait for the current reply to finish, then try again.'
        : error instanceof ApiRequestError && error.status === 413 ? 'This conversation exceeds the 8 MiB download limit. Nothing was downloaded.'
        : 'Could not download this conversation. Check your connection and try again.'
      setNotice({ tone: 'alert', message })
    } finally {
      clearTimeout(timer)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }
  return { download, busy, notice }
}
