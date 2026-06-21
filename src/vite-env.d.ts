/// <reference types="vite/client" />

/** Typed env vars the UI reads. `VITE_API_BASE` lets a packaged desktop host
 *  point the same UI at a local sidecar (`http://127.0.0.1:<port>`); unset, the
 *  UI uses the same-origin `/api/v1`. */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
