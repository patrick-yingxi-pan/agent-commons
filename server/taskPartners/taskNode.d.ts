/** Node surface used to compare committed, parsed protocol values independently
 * of JSON member order. Mirrors the standard library declaration. */
declare module 'node:util' {
  export function isDeepStrictEqual(left: unknown, right: unknown): boolean
}
