import { extractDocx } from './docxExtraction.ts'
import { docxImportFailure } from '../../contract/docxImport.mjs'

// This worker has only selected bytes. It exposes no URL, path or I/O command.
self.onmessage = async (event: MessageEvent<unknown>) => {
  self.postMessage(event.data instanceof Uint8Array
    ? await extractDocx(event.data) : docxImportFailure('invalid'))
}
