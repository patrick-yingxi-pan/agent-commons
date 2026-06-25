/** Test helper: read the repo's own source as data, so "meta" tests can enforce
 *  structural contracts (no framework imports in the contract, every declared SSE
 *  event has a producer + consumer, …). Comments are stripped first so prose or a
 *  commented-out line can't satisfy — or trip — a scan. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Repo root (this file lives at tests/helpers/). */
export const ROOT = join(import.meta.dirname, '..', '..')

/** Absolute paths of every source file under `dir` (recursive), excluding ambient
 *  `.d.ts` declarations (which are erased and never executed). */
export function filesUnder(dir, exts = ['.ts', '.tsx']) {
  const base = join(ROOT, dir)
  return readdirSync(base, { recursive: true })
    .filter((f) => typeof f === 'string' && exts.some((e) => f.endsWith(e)) && !f.endsWith('.d.ts'))
    .map((f) => join(base, f))
}

export const read = (p) => readFileSync(p, 'utf8')

/** Strip block + line comments. Line comments are matched only when `//` follows
 *  start-of-line or whitespace, so a `https://` inside a string survives. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/** Every file under `dir`, comment-stripped and concatenated — for substring/regex
 *  contract scans across a whole component. */
export function concatSource(dir, exts) {
  return filesUnder(dir, exts).map((f) => stripComments(read(f))).join('\n')
}
