/** A detached SVG-as-image decoder. No parsed node is ever inserted into the
 * application document. Image context adds the browser's no-script/no-external-
 * resource boundary to the worker's strict static-document admission.
 * https://www.w3.org/TR/svg-integration/#secure-animated-mode */
export interface SvgImageBitmap {
  width: number
  height: number
  source: HTMLImageElement
  close(): void
}

export function decodeSvgImage(blob: Blob, signal: AbortSignal): Promise<SvgImageBitmap> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Image decoding cancelled.')); return }
    const image = new Image()
    const url = URL.createObjectURL(blob)
    let settled = false
    let released = false
    const close = () => {
      if (released) return
      released = true
      image.onload = null; image.onerror = null
      signal.removeEventListener('abort', abort)
      image.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
    const fail = () => {
      if (settled) return
      settled = true; close(); reject(new Error('SVG image decoding failed.'))
    }
    const abort = () => { if (settled) close(); else fail() }
    image.onload = () => {
      if (settled) return
      if (signal.aborted || !image.naturalWidth || !image.naturalHeight) { fail(); return }
      settled = true
      image.onload = null; image.onerror = null
      resolve({ width: image.naturalWidth, height: image.naturalHeight, source: image, close })
    }
    image.onerror = fail
    signal.addEventListener('abort', abort, { once: true })
    try { image.src = url } catch { fail() }
  })
}
