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
    setHeader(name: string, value: string): void
    write(chunk: string): boolean
    end(chunk?: string): void
    flushHeaders?(): void
    writableEnded: boolean
    on(event: 'close', cb: () => void): void
  }
  export interface Server {
    listen(port: number, host: string, cb?: () => void): Server
    listen(port: number, cb?: () => void): Server
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
  }
  export function readdirSync(path: string): string[]
  export function writeFileSync(path: string, data: string): void
  export function renameSync(oldPath: string, newPath: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
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
}

declare const process: {
  env: Record<string, string | undefined>
  argv: string[]
  cwd(): string
  platform: string
  exit(code?: number): never
  on(event: string, listener: (...args: unknown[]) => void): void
}

declare const Buffer: {
  concat(list: Uint8Array[]): { toString(encoding?: string): string }
  from(data: string, encoding?: string): Uint8Array
}

declare const __dirname: string
declare const __filename: string

/** Base64 codecs (Web/Node globals) — used to make pagination cursors opaque. */
declare function btoa(data: string): string
declare function atob(data: string): string
