/** Deterministic stored ZIP finalization for generated Office packages.
 * Office consumers, including the bundled LibreOffice runtime, require local
 * file headers to carry complete sizes rather than data descriptors. */
import { ZipWriter, TextReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-custom.js'

export async function writeOfficeZip(parts: readonly (readonly [string, string])[]): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0, useWebWorkers: false })
  for (const [path, content] of parts) {
    await writer.add(path, new TextReader(content), {
      lastModDate: new Date(2000, 0, 1),
      extendedTimestamp: false,
      dataDescriptor: false,
    })
  }
  return writer.close()
}
