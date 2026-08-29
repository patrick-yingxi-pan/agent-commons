/** The /ui-review sweep's COVERAGE LEDGER — the cell manifest plus the
 *  bookkeeping that turns "this cell never ran" into a violation.
 *
 *  Split out of scripts/ui-sweep.mjs because it is the sweep's headline claim
 *  and the only part of it that can be tested without a browser: the harness
 *  once reported "0 violations, 31 skips" while most of the narrow column never
 *  ran, and later crashed outright at the first narrow viewport — five columns
 *  lost, no RESULT line at all. Both times a green-looking log stood in for a
 *  matrix nobody had swept. The rule this module encodes:
 *
 *      SILENCE ABOUT A CELL IS A VIOLATION, NOT A PASS.
 *
 *  A cell is covered only when its checks actually ran. Everything else — an
 *  address that rendered nothing, a drawer that would not open, a column that
 *  threw halfway — closes as a COVERAGE violation naming the cell and, when the
 *  harness knew one, the reason. Locked by tests/ui-sweep-coverage.test.ts.
 *  Dependency-free on purpose, so the lock needs no browser. */

/** The rail sections the sweep addresses by canonical URL (ADAPT-15). */
export const SECTIONS = [
  'Commons',
  'Projects',
  'Artifacts',
  'Contexts',
  'Agents',
  'Scheduled',
  'Discussions',
  'Messages',
  'Dispatch',
  'Customize',
]

/** The cell manifest — the sweep's promise of what a green run covered. Every
 *  name here must be marked covered in every viewport column, or the column
 *  closes with a COVERAGE violation. Adding a cell to the sweep means adding it
 *  here; the lock fails on a cell the sweep visits but never promised. */
export const CELLS = [
  'thread-demo',
  'chip-confirm',
  'rail',
  'thread-repo',
  'draft',
  ...SECTIONS.map((s) => s.toLowerCase()),
  'project-detail',
  'project-sharing',
  'scheduled-detail',
  'scheduled-sharing',
  'discussion-detail',
  'artifact-page',
  'profile-detail',
  'profile-section',
]

/** Per-run coverage bookkeeping across every column. */
export function createLedger(cells = CELLS) {
  const swept = new Set()
  const reasons = new Map()
  return {
    /** This cell's checks ran. Wins over any earlier unreachable note — a cell
     *  that failed one route and was reached by another IS covered. */
    covered(cell) {
      swept.add(cell)
      reasons.delete(cell)
    },
    /** This cell could not be checked, and why. Recorded rather than reported
     *  immediately, so `covered` can still overtake it. */
    unreachable(cell, reason) {
      if (!swept.has(cell)) reasons.set(cell, reason)
    },
    get size() {
      return swept.size
    },
    /** The column's verdict: one violation record per cell that never ran. */
    close(column) {
      return cells
        .map((name) => `${column}/${name}`)
        .filter((cell) => !swept.has(cell))
        .map((cell) => ({
          cell,
          invariant: 'COVERAGE',
          detail: `cell UNSWEPT — ${reasons.get(cell) ?? 'the harness never reached it'}`,
        }))
    },
  }
}
