import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

const source = (path: string) => stripComments(read(join(ROOT, path)))

test('Repository → This computer uses the native Git picker as a separate saved snapshot path', () => {
  const repo = source('src/components/RepoContextPicker.tsx')
  const picker = source('src/components/LocalGitConnections.tsx')
  const controller = source('src/controller/localGitConnections.ts')
  assert.ok(repo.includes('localGitAvailable() && <NativeLocalGitPicker'))
  assert.ok(repo.includes('addedLocalGitIds'))
  assert.ok(picker.includes('Remember this connection'))
  assert.ok(picker.includes('captureLocalGit(connection.id)'), 'only explicit Attach captures repository content')
  assert.ok(picker.includes('gitSnapshot }'), 'native Git state uses the distinct gitSnapshot field')
  assert.ok(!/terminal|diff|branch:/i.test(picker), 'native snapshots are not presented as live repository sessions')
  assert.ok(controller.includes('onAccountSwitch(() => localGitConnections.clear())'))
})

test('Contexts page and rail expose the same native Git connection rows and disconnect detail', () => {
  const page = source('src/components/SectionView.tsx')
  const rail = source('src/components/ContextChildren.tsx')
  const detail = source('src/components/LocalGitConnections.tsx')
  assert.ok(page.includes('localGitCollectionSection(localGit.rows, filter, query)'))
  assert.ok(page.includes('LocalGitRow connection={item.value}'))
  assert.ok(page.includes('LocalGitDetail key={contextId}'))
  assert.ok(rail.includes('localGitCollectionSection(localGit.rows, filter)'))
  assert.ok(detail.includes('localGitConnections.disconnect(id)'))
  assert.ok(detail.includes('Opening this page never reads repository files'))
  assert.ok(detail.includes('saved snapshots in conversations remain available as model input'))
})

test('Git snapshot previews disclose saved-only provenance, bounds and exclusions with explicit refresh', () => {
  const panel = source('src/components/panels/ArtifactPanel.tsx')
  const policy = source('src/components/GitSnapshotPolicy.tsx')
  const refresh = source('src/controller/localGitRefresh.ts')
  assert.ok(panel.includes('g.folder?.gitSnapshot'))
  assert.ok(panel.includes('refreshLocalGitFolder'))
  assert.ok(panel.includes('<GitSnapshotPolicy'))
  assert.ok(policy.includes('Tracked working-tree files include uncommitted edits'))
  assert.ok(policy.includes('global Git configuration is not used'))
  assert.ok(policy.includes('Repositories with more than 500 tracked entries cannot be captured'))
  assert.ok(panel.includes('opening and sending do not read the repository'))
  assert.ok(panel.includes('git.files.filter(file =>'))
  assert.ok(refresh.includes('expectedSnapshotId'))
  assert.ok(refresh.includes('captured ??= await captureLocalGit'))
  assert.ok(refresh.includes("kind: 'git'"))
})

test('Repository intake shares the bounded scrolling body with a standing Done and truthful native availability', () => {
  const repo = source('src/components/RepoContextPicker.tsx')
  const picker = source('src/components/LocalGitConnections.tsx')
  assert.match(repo, /data-fs-picker-body className=\{FS_PICKER_BODY_CLASS\}/)
  assert.match(repo, /<\/div>\s*<MultiAddFooter/)
  assert.ok(repo.includes('catalog.data && !localGitAvailable()'))
  assert.ok(picker.includes('Manage ${connection.name}'))
  assert.ok(picker.includes("rel.navigate('contexts', connection.id)"))
  assert.ok(picker.includes('<GitSnapshotPolicy'))
})
