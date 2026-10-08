import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (name: string) => stripComments(read(join(ROOT, 'src', 'components', name)))

test('session connector panels are loaded only on demand behind a closeable recovery shell', () => {
  for (const host of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const code = source(host)
    assert.match(code, /import \{ DeferredConnectorContextPanel as ConnectorPanel \} from '\.\/DeferredConnectorContextPanel'/)
    assert.match(code, /<ConnectorPanel/)
    assert.doesNotMatch(code, /import \{ ConnectorPanel \} from '\.\/ConnectorPanel'/)
  }

  const deferred = source('DeferredConnectorContextPanel.tsx')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ConnectorPanel\.tsx'\)/)
  assert.match(deferred, /connectorIconFor\(this\.props\.connector\.kind\)/)
  assert.match(deferred, /<PanelShell[\s\S]*onClose=\{this\.props\.onClose \?\? noop\}/)
  assert.match(deferred, /Loading connector details/)
  assert.match(deferred, /Couldn’t load this connector panel/)
  assert.match(deferred, /label: 'Reload preview'/)
  assert.match(deferred, /<Panel \{\.\.\.this\.props\} \/>/)
})

test('connector detail and workspace/repository panels stay out of shell imports until focused', () => {
  const section = source('SectionView.tsx')
  assert.match(section, /import \{ DeferredConnectorDetailBody as ConnectorDetailBody \} from '\.\/DeferredConnectorContextPanel'/)
  assert.doesNotMatch(section, /import \{ ConnectorDetailBody \} from '\.\/ConnectorPanel'/)

  for (const host of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const code = source(host)
    assert.match(code, /import \{ DeferredWorkspacePanel as WorkspacePanel \} from '\.\/DeferredWorkspacePanel'/)
    assert.doesNotMatch(code, /import \{ WorkspacePanel \} from '\.\/WorkspacePanel'/)
  }

  const deferredConnector = source('DeferredConnectorContextPanel.tsx')
  assert.match(deferredConnector, /lazy\(\(\) => import\('\.\/ConnectorPanel\.tsx'\)\.then\(\(module\) => \(\{ default: module\.ConnectorDetailBody \}\)\)\)/)
  assert.match(deferredConnector, /Loading connector details/)
  assert.match(deferredConnector, /Couldn’t load connector details/)
  assert.match(deferredConnector, /<DetailBody \{\.\.\.this\.props\} \/>/)

  const deferredWorkspace = source('DeferredWorkspacePanel.tsx')
  assert.match(deferredWorkspace, /lazy\(\(\) => import\('\.\/WorkspacePanel\.tsx'\)/)
  assert.match(deferredWorkspace, /this\.props\.mode === 'repo' \? 'Repository' : 'Workspace'/)
  assert.match(deferredWorkspace, /onClose=\{this\.props\.onClose\}/)
  assert.match(deferredWorkspace, /const subject = title\.toLowerCase\(\)/)
  assert.match(deferredWorkspace, /`Loading \$\{subject\} panel/)
  assert.match(deferredWorkspace, /`Couldn’t load this \$\{subject\} panel/)
  assert.match(deferredWorkspace, /label: 'Reload preview'/)
})
