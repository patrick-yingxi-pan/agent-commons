/** The copy-to-clipboard button (src/components/CopyButton.tsx, cue in
 *  src/lib/copyButton.ts) — the one "Copy" affordance, worn by the rendezvous-secret
 *  reveal, the A2A-card viewer, and any future copy control. Form follows function:
 *  one styled primitive, defined once. These lock that:
 *    1. the shared class is a real compact copy-pill cue,
 *    2. the consumer (SectionView) sources <CopyButton> from the module, and
 *    3. nothing re-hardcodes the pill literal (a fourth hand-rolled copy button). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from '../../tests/helpers/source.ts'
import { COPY_BUTTON_CLASS } from './copyButton.ts'

test('the shared copy-button class is a compact bordered pill cue', () => {
  for (const piece of ['rounded-md', 'border', 'hover:border-accent', 'hover:text-ink']) {
    assert.ok(COPY_BUTTON_CLASS.includes(piece), `keeps "${piece}"`)
  }
})

test('SectionView sources its copy buttons from the shared component', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(src, /from\s+'\.\/CopyButton'/, 'imports the shared component')
  // The rendezvous-secret reveal (3) + the A2A-card viewer (url + JSON) all route
  // through <CopyButton>, so the tag appears several times.
  assert.ok((src.match(/<CopyButton\b/g) ?? []).length >= 4, 'multiple copy affordances wear the shared component')
})

test('the copy-pill literal is defined once — no component re-hardcodes it', () => {
  // The literal lives only in src/lib/copyButton.ts; every component must consume the
  // constant, never inline the markup. Scan all components (comment-stripped so a
  // commented example can neither satisfy nor trip the scan).
  for (const file of filesUnder('src/components')) {
    assert.ok(
      !stripComments(read(file)).includes(COPY_BUTTON_CLASS),
      `${file} must take the copy-button cue from lib/copyButton, not re-hardcode it`,
    )
  }
})

test('the clipboard write itself is funneled — only CopyButton touches navigator.clipboard', () => {
  // The deeper enumeration handle: a copy affordance that bypasses <CopyButton>
  // shows up as a stray clipboard call (the PromptCard's icon button did exactly
  // this — no "Copied" feedback, its own markup). Scanning for the API call
  // catches the next escape even if it invents entirely new styling.
  for (const file of filesUnder('src')) {
    if (file.endsWith(join('components', 'CopyButton.tsx'))) continue
    assert.ok(
      !stripComments(read(file)).includes('navigator.clipboard'),
      `${file} must route its copy affordance through <CopyButton>, not call the clipboard directly`,
    )
  }
})
