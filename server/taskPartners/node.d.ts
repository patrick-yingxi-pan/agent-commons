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
  export function randomInt(max:number): number
  interface PartnerVerificationKey { readonly type: 'public' }
  export function createPublicKey(options: {key: { kty:string; crv:string; x:string }; format:'jwk'}): PartnerVerificationKey
  export function verify(algorithm: null, data: Uint8Array, key: PartnerVerificationKey, signature: Uint8Array): boolean
  export function createHash(algorithm:string): {update(data:string | Uint8Array):{digest():Buffer; digest(encoding:string):string}}
}
