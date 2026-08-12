/** Test helper: read the repo's own source as data, so "meta" tests can enforce
 *  structural contracts (no framework imports in the contract, every declared SSE
 *  event has a producer + consumer, …). Comments are stripped first so prose or a
 *  commented-out line can't satisfy — or trip — a scan. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Repo root (this file lives at tests/helpers/). */
export const ROOT = join(import.meta.dirname, '..', '..')

/** Absolute paths of every source file under `dir` (recursive), excluding ambient
 *  `.d.ts` declarations (which are erased and never executed) and the SUITES
 *  themselves.
 *
 *  Suites are excluded because every lock built on this helper asks a question
 *  about the SHIPPED source — "does any surface still use `pl-14`", "does
 *  anything here use non-erasable TypeScript". Once the suites colocated into
 *  `src/` and `server/`, this walk started reaching them, and a suite that
 *  QUOTES the string it forbids became its own counter-example: the `pl-14`
 *  lock failed by finding the sentence in which it names `pl-14`. That is a
 *  false positive with a nasty shape, because the honest fix looks like
 *  weakening the rule. Excluded here, once, rather than at each of the dozen
 *  call sites — and no coverage is lost, since a suite proves itself by
 *  running. */
export function filesUnder(dir, exts = ['.ts', '.tsx']) {
  const base = join(ROOT, dir)
  const found = readdirSync(base, { recursive: true })
    .filter(
      (f) =>
        typeof f === 'string' &&
        exts.some((e) => f.endsWith(e)) &&
        !f.endsWith('.d.ts') &&
        !f.endsWith('.test.ts') &&
        !f.endsWith('.test.tsx') &&
        !/(^|[\\/])testkit[\\/]/.test(f),
    )
    .map((f) => join(base, f))
  // A source scan that finds NOTHING passes every assertion it was going to
  // make, having checked nothing — the vacuity that green suites hide. This
  // helper backs a dozen enumerating locks, so one guard here makes all of them
  // fail loudly instead (a moved directory, a changed extension, a bad `dir`).
  if (found.length === 0) {
    throw new Error(
      `filesUnder('${dir}') matched no ${exts.join('/')} files — a scan over nothing would pass vacuously. Check the path.`,
    )
  }
  return found
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

/** One named top-level component's body out of `src/components/SectionView.tsx`
 *  — the file is one big module of column-0 declarations, so "everything from
 *  this declaration to the next" IS the component.
 *
 *  Shared because two suites parse it (thread-composer and social-ui), and two
 *  copies of a parser drift: when SectionView's declaration style changes, the
 *  copy that isn't updated silently returns the WRONG body, and a scan over the
 *  wrong body passes vacuously — the exact failure tests/CLAUDE.md warns about.
 *  Asserts the component exists, so an assertion over it can never read nothing. */
export function sectionViewComponent(name) {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  const bodies = src.split(/\n(?=(?:export )?(?:function|const) [A-Za-z])/)
  // Matched with plain string work, NOT `new RegExp(\`…${name}\\b\`)`: inside a
  // template literal `\b` is the BACKSPACE character, so that pattern silently
  // matches nothing and every scan over the result passes vacuously. This file's
  // own first draft shipped exactly that — the hazard tests/CLAUDE.md names.
  const heads = ['export function ', 'export const ', 'function ', 'const ']
  const hit = bodies.find((b) =>
    heads.some((h) => {
      if (!b.startsWith(h + name)) return false
      const next = b[h.length + name.length] // the boundary `\b` was meant to assert
      return next === undefined || !/[A-Za-z0-9_$]/.test(next)
    }),
  )
  if (!hit) throw new Error(`SectionView has no top-level component '${name}' — this scan has no subject`)
  return hit
}
