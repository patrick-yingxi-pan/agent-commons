import { extractDocx } from './docxExtraction.ts'
import { extractXlsx } from './xlsxExtraction.ts'
import { docxImportFailure } from '../../contract/docxImport.mjs'
import { xlsxImportFailure } from '../../contract/xlsxImport.mjs'

// One emitted Office worker shares ZIP/XML machinery. Each invocation still
// owns an isolated worker, bounded bytes and no URL, path or I/O command.
self.onmessage = async (event: MessageEvent<unknown>) => {
  const value = event.data
  if (!value || typeof value !== 'object' || !('format' in value) || !('bytes' in value)) throw new Error('Invalid Office import request.')
  if (value.format === 'docx') self.postMessage(value.bytes instanceof Uint8Array ? await extractDocx(value.bytes) : docxImportFailure('invalid'))
  else if (value.format === 'xlsx') self.postMessage(value.bytes instanceof Uint8Array ? await extractXlsx(value.bytes) : xlsxImportFailure('invalid'))
  else throw new Error('Invalid Office import format.')
}
