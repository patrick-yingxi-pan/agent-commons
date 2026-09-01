/** Structural half of UI-E34; the browser spec proves the rendered recovery. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('Project creation waits for server identity through one shell recovery surface', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'RelationMutationNotice.tsx')))
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const contract = stripComments(read(join(ROOT, 'contract', 'api.ts')))

  assert.match(app, /lazy\(\(\) =>[\s\S]*?ShellMutationNotices/)
  assert.equal((shell.match(/<RelationMutationNotice\s*\/>/g) ?? []).length, 1)
  assert.doesNotMatch(`${app}\n${shell}`, /ProjectCreationNotice/)
  assert.match(notice, /data-relation-mutation=/)
  assert.match(section, /<NewProjectDialog[\s\S]*?busy=\{creatingProject\}/)
  assert.match(section, /waitingForRecovery=\{creatingProject && !!rel\.mutation\.error\}/)
  assert.match(section, /rel\.createProject\(\{[\s\S]*?name,[\s\S]*?description,/)
  assert.match(section, /onOpenProject\(outcome\.resource\.id\)/)
  assert.doesNotMatch(section, /uniqueProjectId|projectId: id/)
  const request = contract.match(/export interface CreateProjectRequest \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.ok(request, 'the direct-create request contract exists')
  assert.doesNotMatch(request, /\bid\??:/, 'the browser cannot supply Project identity')
})
