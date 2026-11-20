/** Narrow native primitives used by the partner registry. Runtime verification
 * and DNS observations both terminate in Node's own implementations. */
declare module 'node:dns/promises' {
  export class Resolver {
    constructor(options?: {timeout?: number; tries?: number})
    resolveTxt(hostname: string): Promise<string[][]>
  }
}
declare module 'node:url' {
  export function domainToASCII(name: string): string
  export function domainToUnicode(name: string): string
}
declare module 'node:crypto' {
  export interface KeyObject {
    export(options: {format: 'pem'; type: 'pkcs8'}): string
    export(options: {format: 'jwk'}): {x?: string}
  }
  export function generateKeyPairSync(type: 'ed25519'): {privateKey: KeyObject; publicKey: KeyObject}
  export function createPrivateKey(pem: string): KeyObject
  export function createPublicKey(key: KeyObject): KeyObject
  export function sign(algorithm: null, data: Uint8Array, key: KeyObject): Buffer
  export function randomInt(max:number): number
  interface PartnerVerificationKey { readonly type: 'public' }
  export function createPublicKey(options: {key: { kty:string; crv:string; x:string }; format:'jwk'}): PartnerVerificationKey
  export function verify(algorithm: null, data: Uint8Array, key: PartnerVerificationKey, signature: Uint8Array): boolean
  export function createHash(algorithm:string): {update(data:string | Uint8Array):{digest():Buffer; digest(encoding:string):string}}
}
declare module 'node:fs' {
  export function unlinkSync(path: string): void
  export function writeFileSync(path: string, data: string, options: {mode: number; flag: 'wx'}): void
}
