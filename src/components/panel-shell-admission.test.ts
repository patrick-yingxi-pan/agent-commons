import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (name: string) => stripComments(read(join(ROOT, 'src/components', name)))

test('one panel admission fence rejects late lazy shells without claiming ordinary motion exits', () => {
  const shell = source('PanelShell.tsx')
  assert.match(shell, /scopePanelPresence\(parent, active\)/)
  assert.match(shell, /<PresenceContext\.Provider value=\{scoped\}><PanelShellBody/)
  assert.match(shell, /const present = useIsPresent\(\)/)
  assert.match(shell, /const admittedAtMount = useRef\(present\)\.current/)
  assert.match(shell, /if \(admittedAtMount \|\| !presence \|\| presence\.isPresent\) return/, 'only a rejected absent shell owns manual completion')
  assert.match(shell, /const unregister = presence\.register\(presenceId\)/)
  assert.match(shell, /presence\.onExitComplete\?\.\(presenceId\)/)
  assert.match(shell, /return unregister/, 'temporary late-shell claims cannot leak across fallback replacement or reopening')
  const refusal = shell.indexOf('if (!admittedAtMount) return null')
  assert.ok(refusal > 0 && refusal < shell.indexOf('<motion.div'), 'a late shell cannot create an entering motion root')
  for (const name of ['WorkspacePanel', 'ConnectorPanel', 'AttachmentPanel', 'DiscussionContextPanel', 'ArtifactContextPanel']) {
    assert.match(source(`${name}.tsx`), /<PanelShell/, `${name} shares the late-admission fence`)
  }
  for (const name of ['DeferredWorkspacePanel', 'DeferredConnectorContextPanel', 'DeferredAttachmentPanel', 'DeferredDiscussionContextPanel', 'DeferredArtifactContextPanel']) {
    assert.match(source(`${name}.tsx`), /<PanelShell/, `${name}'s loading/recovery chrome shares the same fence`)
  }
})

test('attachment panels mount only when their exact addressed item is in the live projection', () => {
  const context = source('ContextPanelView.tsx')
  assert.match(context, /if \(!focusValidIn\(live, panel\)\) return null/)
  assert.match(context, /case 'file':[\s\S]*case 'photo': \{[\s\S]*if \(!focusValidIn\(live, panel\)\) return null[\s\S]*<DeferredAttachmentPanel/)

  const overlay = source('OverlayPanelDock.tsx')
  assert.match(overlay, /const attachmentFocus = focus && \(focus\.kind === 'file' \|\| focus\.kind === 'photo'\) && focusValidIn\(live, focus\) \? focus : null/)
  assert.match(overlay, /\{attachmentFocus && \([\s\S]*<DeferredAttachmentPanel/)
})
