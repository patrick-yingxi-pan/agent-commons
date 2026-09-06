import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('every sharing host retains one frozen draft behind the shell recovery door', () => {
  const boundary = stripComments(read(join(ROOT, 'src', 'components', 'GrantsPanel.tsx')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'GrantsPanelContent.tsx')))
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const artifact = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  const session = stripComments(read(join(ROOT, 'src', 'components', 'SessionShareButton.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx')))

  assert.match(panel, /enqueueGrantChange[\s\S]*enqueueGrantRevocation/,
    'create and revoke enter the same acknowledgement controller')
  assert.doesNotMatch(panel, /import \{[^}]*createGrant[^}]*\} from '\.\.\/api'/,
    'the component cannot retain a fire-and-forget transport path')
  assert.match(panel, /const outcome = await settle\('share'/,
    'authored values clear only after the logical share settles')
  assert.match(panel, /if \(outcome === 'applied'\)[\s\S]*setAudId\(''\)[\s\S]*setNote\(''\)/,
    'acknowledgement, never submission, clears the exact share draft')
  assert.match(panel, /<fieldset disabled=\{held\}/,
    'the retry payload cannot drift while its outcome is unknown')
  assert.match(panel, /useEffect\(\(\) => onHeldChange\?\.\(held\)/,
    'duplicate projections inherit the same per-subject hold')
  assert.match(panel, /onHeldChange\?\.\(isGrantMutationHeld\(subject\)\)/,
    'one settled projection cannot release a still-queued sibling hold')
  assert.match(panel, /maxLength=\{MAX_GRANT_NOTE_CHARS\}/,
    'the UI and server share one note boundary')
  assert.match(panel, /const noteHelpId = useId\(\)/,
    'the note help gets a stable per-instance description id')
  assert.match(panel, /aria-describedby=\{noteHelpId\}[\s\S]*placeholder="Optional note"/,
    'the note keeps its existing accessible label while using concise narrow copy')
  assert.match(panel, /<p id=\{noteHelpId\}[\s\S]*Add a note to publish to this audience\. Leave blank to share access only\./,
    'sharing guidance is persistent associated prose, not a clipped placeholder')

  for (const [name, source] of [['project/routine', section], ['artifact', artifact]] as const) {
    assert.match(source, /heldOpen=\{sharingHeld\}/, `${name} sharing section stays mounted while held`)
    assert.match(source, /onHeldChange=\{setSharingHeld\}/, `${name} host owns the section hold`)
  }
  assert.match(session, /if \(!held\) setOpen\(false\)/,
    'outside dismissal cannot unmount a held conversation share')
  assert.match(session, /onHeldChange=\{setHeld\}/,
    'the conversation popover observes the same hold')
  assert.match(boundary, /lazy\(\(\) =>[\s\S]*?import\('\.\/GrantsPanelContent'\)/,
    'the low-frequency sharing form stays out of the critical bundle')
  assert.match(boundary, /<Suspense fallback=/,
    'the lazy sharing form has an explicit loading state')
  assert.match(shell, /<GrantMutationNotice \/>/,
    'Retry and Dismiss remain reachable after navigation')
  assert.match(notice, /data-grant-mutation=\{kind === 'grant' \? phase : undefined\}/,
    'E2E has a semantic handle for pending and failed sharing state')
})
