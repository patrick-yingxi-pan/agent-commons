/** The primary desktop path must stay navigable without pointer or visual
 * inference. Browser behavior is exercised in e2e/accessibility-navigation;
 * this source lock keeps the one shell bypass and the conversation semantics
 * from being locally redrawn or quietly dropped. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('the shell owns one keyboard bypass whose target survives the responsive rail', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const skip = stripComments(read(join(ROOT, 'src', 'components', 'SkipToMain.tsx')))

  assert.equal((app.match(/<SkipToMain /g) ?? []).length, 1, 'the workspace renders one bypass control')
  assert.match(app, /<SkipToMain onSkip=\{skipToMain\} \/>/, 'the shell owns the bypass action')
  assert.match(app, /<main[\s\S]*?ref=\{mainRef\}[\s\S]*?id="main-workspace"[\s\S]*?tabIndex=\{-1\}/,
    'the one main landmark is a programmatic focus target')
  assert.match(app, /if \(railOverlay && leftOpen\)[\s\S]*?closeLeft\(\)[\s\S]*?requestAnimationFrame/,
    'bypassing a narrow open drawer dismisses its inert overlay before focus moves')

  assert.match(skip, /type="button"/, 'the bypass does not mutate browser history')
  assert.match(skip, />\s*Skip to main content\s*<\/button>/, 'the bypass has a stable accessible name')
  assert.match(skip, /-translate-y-\[calc\(100%\+1rem\)\]/, 'the resting control stays outside the viewport')
  assert.match(skip, /focus-visible:translate-y-0/, 'keyboard focus reveals the control')
  assert.match(skip, /motion-reduce:transition-none/, 'revealing the bypass respects reduced motion')
})

test('a conversation exposes resource identity and a persistent composer name', () => {
  const title = stripComments(read(join(ROOT, 'src', 'components', 'SessionTitleBar.tsx')))
  const composer = stripComments(read(join(ROOT, 'src', 'components', 'Composer.tsx')))

  assert.match(title, /<h1[^>]*>[\s\S]*?\{session\.title\}[\s\S]*?<\/h1>/,
    'the conversation title participates in heading navigation')
  assert.match(composer, /<textarea[\s\S]*?aria-label="Message"[\s\S]*?placeholder=/,
    'the message field keeps its name when placeholder copy changes or disappears')
})
