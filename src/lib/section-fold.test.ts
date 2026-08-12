/** The page-section fold posture (`src/lib/sectionFold.ts`).
 *
 *  Pure and DOM-free, so the parts that fail SILENTLY are held here rather than
 *  in a screenshot: a key that changes when a title is re-capitalised (the
 *  reader's posture quietly resets), a default that overrides the stored value
 *  (a section you unfolded folds itself again on every visit), and a fold-all
 *  pair that offers the act it has no work for.
 *
 *  `uiPrefs` is stubbed at the module boundary rather than mocked: it guards its
 *  own `localStorage` access and returns the fallback when there is no DOM, so a
 *  node run reads every section as its default. That is enough for the key and
 *  the pair, and the STORED half is exercised where storage exists —
 *  `e2e/project-page.spec.ts`. Said plainly instead of asserting a truth this
 *  environment cannot produce. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSectionFolded, pageFoldWork, sectionFoldKey } from './sectionFold.ts'

test('the key survives how a title is written, and separates sections that differ', () => {
  // A title is human copy. The header uppercases in CSS, so the source string is
  // whatever the author typed — and a key derived from it raw would mint a
  // second entry the day someone writes "Open Work", silently resetting the
  // posture of everyone who had folded "Open work".
  assert.equal(sectionFoldKey('Open work'), sectionFoldKey('OPEN WORK'))
  assert.equal(sectionFoldKey('Open work'), sectionFoldKey('  open work  '))
  assert.equal(sectionFoldKey('Recent sessions'), sectionFoldKey('Recent  sessions'))
  // …and it is still a key per SECTION: two sections must never share a posture.
  const distinct = ['About', 'Sharing', 'Scheduled', 'Context', 'Open work'].map(sectionFoldKey)
  assert.equal(new Set(distinct).size, distinct.length, 'every section gets its own entry')
  // Namespaced, so it cannot collide with the rail's own layout keys in the one
  // per-account blob.
  for (const t of ['About', 'Sharing']) assert.match(sectionFoldKey(t), /^fold\.section\./)
  // Bounded and JSON-safe: the argument for persisting this at all (see the
  // module header's contrast with `lib/disclosure.ts`) is that the key space is
  // the closed set of section titles, so a key must never carry free text.
  assert.match(sectionFoldKey('Context & repos (beta)!'), /^fold\.section\.[a-z0-9-]+$/)
})

test('the default is the CALLER’s declaration, and stored state is absent here', () => {
  // Node has no `localStorage`, so `getLayout` returns the fallback — which
  // makes this an assertion about the default path only, and that is what it
  // says it is. Configuration declares itself folded; content declares nothing.
  assert.equal(isSectionFolded('Sharing', true), true, 'configuration opens folded')
  assert.equal(isSectionFolded('Discussion', false), false, 'content opens open')
  assert.equal(isSectionFolded('Discussion'), false, 'and the default default is open')
})

test('Fold all and Unfold all each appear only when they have work', () => {
  // SOCIAL-21's rule, adopted rather than re-derived: they are NOT inverses, so
  // a single `allFolded` toggle vanishes exactly when it is needed — fold
  // everything, open one section to read it, and the way back has relabelled
  // itself. Every route into a partly-folded page hit that dead end in the
  // thread; this is the same shape with sections.
  const folded = new Set(['Sharing', 'Context'])
  const all = ['About', 'Discussion', 'Sharing', 'Context']
  const work = pageFoldWork(all, (t) => folded.has(t))
  assert.deepEqual(work.foldable, ['About', 'Discussion'], 'Fold all has the open ones to close')
  assert.deepEqual(work.unfoldable, ['Sharing', 'Context'], 'Unfold all has the closed ones to open')

  // The two ends, which are where a single toggle broke: at each, exactly one
  // act is live and the other must not render.
  const none = pageFoldWork(all, () => false)
  assert.deepEqual(none.unfoldable, [], 'nothing folded ⇒ Unfold all has no work')
  assert.equal(none.foldable.length, all.length)
  const every = pageFoldWork(all, () => true)
  assert.deepEqual(every.foldable, [], 'everything folded ⇒ Fold all has no work')
  assert.equal(every.unfoldable.length, all.length)

  // A page that rendered no sections offers neither, rather than two inert
  // controls over an empty set.
  const empty = pageFoldWork([], () => false)
  assert.deepEqual([empty.foldable, empty.unfoldable], [[], []])

  // Total over the input, in order: the controls act on exactly what the page
  // registered, and the split loses nothing. A section missing from BOTH lists
  // is a section neither act can reach — the silent-subtraction failure, one
  // layer down from the registry that feeds it.
  assert.deepEqual([...work.foldable, ...work.unfoldable].sort(), [...all].sort())
})
