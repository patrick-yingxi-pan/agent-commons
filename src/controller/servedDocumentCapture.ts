import { documentImportCopy, type DocumentImportOutcome } from '../../contract/documentImport.mjs'
import { isServedTextSnapshot, type ServedDocumentSnapshot } from '../../contract/servedTextSnapshot.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { readFsDocumentBytes } from '../api/fsDocumentBytes.ts'
import { documentReaderForName } from '../lib/documentFileImport.ts'

interface CaptureDependencies {
  read?: typeof readFsDocumentBytes
  reader?: typeof documentReaderForName
}

/** Capture is an explicit gesture, never a hook. Extraction is isolated by the
 * shared importers; both account transitions and picker dismissal cancel it. */
export async function captureServedDocument(sourceId: string, path: string, snapshotId: string, signal?: AbortSignal, deps: CaptureDependencies = {}): Promise<ServedDocumentSnapshot> {
  const reader = (deps.reader ?? documentReaderForName)(path)
  if (!reader) throw new Error('This document format is not supported.')
  const generation = accountGeneration()
  const controller = new AbortController()
  const unsubscribe = onAccountSwitch(() => controller.abort())
  const intake = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  const assertCurrent = () => {
    if (generation !== accountGeneration()) throw new Error('Your account changed. Nothing was saved.')
    intake.throwIfAborted()
  }
  try {
    assertCurrent()
    const bytes = await (deps.read ?? readFsDocumentBytes)(sourceId, path, reader.maxBytes, intake)
    assertCurrent()
    const capturedAt = new Date().toISOString()
    const result = await reader.read(bytes, intake)
    assertCurrent()
    if (result.documentImport.status !== 'ready') throw new Error(documentImportCopy(result.documentImport as DocumentImportOutcome))
    const snapshot = { version: 2 as const, snapshotId, capturedAt, sourceId, path, text: result.text, documentImport: result.documentImport }
    if (!isServedTextSnapshot(snapshot) || snapshot.version !== 2) throw new Error('The document returned an invalid saved copy. Nothing was saved.')
    return snapshot
  } finally {
    controller.abort()
    unsubscribe()
  }
}
