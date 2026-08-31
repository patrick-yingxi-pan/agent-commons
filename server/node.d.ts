/** Minimal ambient declarations for the Node built-ins the mock server uses, so
 *  the server type-checks against the shared contract without pulling in the full
 *  `@types/node` dev dependency (the prototype stays zero-install — Node 26 runs
 *  the TypeScript directly). Only the surface we actually touch is declared. */

declare module 'node:http' {
  export interface IncomingMessage {
    url?: string
    method?: string
    headers: Record<string, string | string[] | undefined>
    on(event: 'data', cb: (chunk: unknown) => void): void
    on(event: 'end', cb: () => void): void
    on(event: 'error', cb: (err: unknown) => void): void
    on(event: 'close', cb: () => void): void
  }
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): ServerResponse
    setHeader(name: string, value: string | number | string[]): void
    write(chunk: string): boolean
    end(chunk?: string | Uint8Array): void
    flushHeaders?(): void
    writableEnded: boolean
    on(event: 'close', cb: () => void): void
  }
  export interface Server {
    listen(port: number, host: string, cb?: () => void): Server
    listen(port: number, cb?: () => void): Server
    /** Stop accepting new connections; the callback fires once all are closed. */
    close(cb?: (err?: Error) => void): Server
    /** Force-close all active connections (Node 18.2+) — used to bound a drain so a
     *  long-lived stream (SSE) can't hold the close() open indefinitely. */
    closeAllConnections?(): void
    /** Server events ('error' on a port clash — the dev boot reports it). */
    on(event: string, listener: (...args: never[]) => void): Server
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server
}

declare module 'node:fs' {
  export function readFileSync(path: string): { toString(): string } & Uint8Array
  export function readFileSync(path: string, encoding: string): string
  export function existsSync(path: string): boolean
  export function statSync(path: string): {
    isFile(): boolean
    isDirectory(): boolean
    size: number
    mtimeMs: number
    mode: number
  }
  export function readdirSync(path: string): string[]
  export function chmodSync(path: string, mode: number): void
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void
  export function renameSync(oldPath: string, newPath: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function extname(p: string): string
  export function resolve(...parts: string[]): string
  export function dirname(p: string): string
  export function basename(p: string, ext?: string): string
  export function relative(from: string, to: string): string
  export const sep: string
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:module' {
  /** Returns a CommonJS `require` bound to `path` — used to load `node:sqlite`
   *  lazily from ESM without an async dynamic import (see persistence/sqlite.ts). */
  export function createRequire(path: string | URL): (id: string) => unknown
  /** Erase TypeScript syntax from source (the runtime's own type stripper) — the
   *  `GET /connector` route serves the checked-in connector TS as plain JS so a
   *  public user can run it with any Node, no repo clone (spec MODEL-14). */
  export function stripTypeScriptTypes(code: string, options?: { mode?: 'strip' | 'transform' }): string
}

declare module 'node:crypto' {
  /** Constant-time buffer comparison (throws if lengths differ) — for secret compares. */
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
  /** Cryptographically random bytes — rendezvous-secret minting (server/relay.ts). */
  export function randomBytes(size: number): { toString(encoding: string): string }
  /** Streaming hash — SHA-256 of the rendezvous secret (only the hash persists). */
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string }
  }
  /** Keyed MAC — the session cookie's signature (server/auth.ts). */
  export function createHmac(algorithm: string, key: string | Uint8Array): {
    update(data: string): {
      /** No encoding ⇒ raw bytes (the session MAC compares them constant-time). */
      digest(): Buffer
      digest(encoding: string): string
    }
  }
  /** RFC-4122 id — account/session ids that must not be guessable. */
  export function randomUUID(): string
  /** Password KDF (server/accounts.ts) — the demo credential store's hash. */
  export function scryptSync(password: string, salt: string | Uint8Array, keylen: number): Buffer
}

declare const process: {
  env: Record<string, string | undefined>
  argv: string[]
  cwd(): string
  pid: number
  platform: string
  exit(code?: number): never
  on(event: string, listener: (...args: unknown[]) => void): void
}

/** Buffer as a TYPE as well as a value: `node:crypto`'s KDFs return one and the
 *  request readers annotate one, and a value-only declaration made every such
 *  annotation a type error — which is why `server/` went untypechecked. */
interface Buffer extends Uint8Array {
  toString(encoding?: string): string
}
declare const Buffer: {
  concat(list: Uint8Array[]): Buffer
  from(data: string, encoding?: string): Buffer
  isBuffer(v: unknown): v is Buffer
}

/** Node's timer handles are objects with `unref()` — a daemon tick must not hold
 *  the process open. The DOM lib types these as `number`, so declare the Node
 *  shape explicitly rather than casting at every call site. */
interface NodeTimer {
  unref(): NodeTimer
  ref(): NodeTimer
}
declare function setTimeout(handler: () => void, ms?: number): NodeTimer
declare function setInterval(handler: () => void, ms?: number): NodeTimer
declare function clearTimeout(handle?: NodeTimer | number): void
declare function clearInterval(handle?: NodeTimer | number): void

declare const __dirname: string
declare const __filename: string

/** Base64 codecs (Web/Node globals) — used to make pagination cursors opaque. */
declare function btoa(data: string): string
declare function atob(data: string): string
