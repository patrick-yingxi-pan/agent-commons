import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import type { ImageAssetRef } from '../../contract/imageAssets.ts'
import { readImageOriginal, readImageOriginalInfo } from '../api/imageAssets.ts'
import { ApiRequestError } from '../api/client.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { downloadBlob } from '../lib/downloadText.ts'
import { decodeImageOriginalDownload, matchesImageOriginalInfo, IMAGE_ORIGINAL_PRIVACY_COPY } from '../lib/imageOriginalDownload.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

/** Check current original authority rather than inferring it from a public
 * asset reference or the enclosing conversation's writable state. */
export function ImageOriginalDownload({ image }: { image: ImageAssetRef }) {
  const active = useRef<AbortController | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'failed' | 'busy'>('loading')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    active.current = controller
    const generation = accountGeneration()
    const current = () => !controller.signal.aborted && active.current === controller && generation === accountGeneration()
    const unsubscribe = onAccountSwitch(() => { active.current?.abort(); active.current = null; setState('unavailable'); setNotice('') })
    const timer = setTimeout(() => controller.abort(), 30_000)
    setState('loading'); setNotice('')
    void readImageOriginalInfo(image.id, controller.signal).then((info) => {
      if (!current()) return
      if (!matchesImageOriginalInfo(info, image)) throw new Error('Unexpected original metadata')
      setState('ready')
    }).catch((error) => {
      if (active.current !== controller || generation !== accountGeneration()) return
      setState(error instanceof ApiRequestError && error.status === 404 ? 'unavailable' : 'failed')
    }).finally(() => { clearTimeout(timer); if (active.current === controller) active.current = null })
    return () => { controller.abort(); active.current?.abort(); active.current = null; clearTimeout(timer); unsubscribe() }
  }, [image.id, image.originalByteLength, attempt])

  async function download() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const generation = accountGeneration()
    let timedOut = false
    let unavailable = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
    setState('busy'); setNotice('')
    try {
      const file = await readImageOriginal(image.id, controller.signal)
      if (controller.signal.aborted || active.current !== controller || generation !== accountGeneration()) return
      downloadBlob(decodeImageOriginalDownload(file, image))
      setNotice('Original download requested.')
    } catch (error) {
      if (active.current !== controller || generation !== accountGeneration()) return
      unavailable = error instanceof ApiRequestError && error.status === 404
      if (!unavailable) setNotice(timedOut ? 'Could not download the original: the request timed out. Try again.' : 'Could not download the original. Try again.')
    } finally {
      clearTimeout(timer)
      if (active.current === controller && generation === accountGeneration()) {
        active.current = null
        setState(unavailable ? 'unavailable' : 'ready')
      }
    }
  }

  return <div data-image-original={state} className="mb-2 shrink-0 space-y-1.5">
    <p role="status" className="text-[11px] leading-snug text-ink-soft">{state === 'loading' ? 'Checking original availability…'
      : state === 'unavailable' ? 'The original is not available to this account.'
      : IMAGE_ORIGINAL_PRIVACY_COPY}</p>
    {state === 'failed' ? <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => setAttempt((n) => n + 1)}>Retry original availability</button>
      : (state === 'ready' || state === 'busy') && <button type="button" disabled={state === 'busy'} onClick={() => { void download() }} className={`${SECONDARY_BUTTON_CLASS} inline-flex items-center gap-1.5 px-2 py-1 text-[12px]`}><Download size={13} />{state === 'busy' ? 'Preparing original…' : 'Download original'}</button>}
    {state === 'failed' && <p role="alert" className="text-[11px] text-danger-text">Could not check the original. Try again.</p>}
    {notice && <p role={notice.startsWith('Could not') ? 'alert' : 'status'} className={`text-[11px] ${notice.startsWith('Could not') ? 'text-danger-text' : 'text-ink-soft'}`}>{notice}</p>}
  </div>
}
