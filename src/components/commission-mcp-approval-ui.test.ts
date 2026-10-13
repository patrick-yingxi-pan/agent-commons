import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROW_DETAIL_CLASS } from '../lib/rowDetail.ts'
import { join } from 'node:path'
import { read, ROOT } from '../../tests/helpers/source.ts'

const source = (name: string) => read(join(ROOT, 'src', 'components', name))
test('inline Contributor approval spans the row rather than competing with header actions', () => {
  assert.match(ROW_DETAIL_CLASS, /col-span-full/)
  assert.match(ROW_DETAIL_CLASS, /min-w-0/)
  const section = source('SectionView.tsx')
  const row = section.slice(section.indexOf('function ContributorRow('), section.indexOf('function CoordinationPanel('))
  assert.match(row, /data-contributor-row/)
  assert.match(row, /className="group grid grid-cols-\[10px_minmax\(0,1fr\)_auto\]/)
  assert.match(row, /<CardActions[\s\S]*?commission\.mine === true && <div className=\{ROW_DETAIL_CLASS\}/)
})
test('Commission approval is a private persistent row surface with shell-owned exact decision recovery', () => {
  const section = source('SectionView.tsx')
  const panel = source('CommissionMcpApprovalPanel.tsx')
  assert.match(section, /commission\.mine === true &&[\s\S]*?DeferredCommissionMcpApprovalPanel/)
  assert.match(section, /mutationHeld = deleting \|\| isCommissionMutationHeld\(commission\.id\) \|\| isCommissionMcpHeld\(commission\.id\)/)
  assert.match(panel, /commissionMcpHeldPresentation\(commissionId\)/)
  assert.match(panel, /enqueueCommissionMcpMutation\(commissionId, request, presentation\)/)
  assert.match(panel, /const currentQuery = useCommissionMcpReview\(commissionId\)/, 'replacement choices cannot relabel the existing approval')
  assert.match(panel, /const active = !!current\?\.active/)
  assert.match(panel, /const review = unavailable \? undefined/)
  assert.match(panel, /query\.status === 'success' && currentQuery\.status === 'success' && providersQuery\.status === 'success'/)
  assert.match(panel, /commissionApprovalMatchesReview\(frozen\.approval, review, now\)/)
  assert.match(panel, /Private work receipts/)
  assert.match(panel, /No receipt can be retried/)
  assert.doesNotMatch(panel, /apiPost|fetch\(|runCommissionMcpWork/, 'reading receipts never invokes execution')
  assert.match(source('CommissionMcpMutationNotice.tsx'), /<RevisionedMutationNotice kind="commission-mcp"/)
  assert.equal((source('ShellMutationNotices.tsx').match(/<CommissionMcpMutationNotice\s*\/>/g) ?? []).length, 1)
  assert.match(source('DeferredCommissionMcpApprovalPanel.tsx'), /<DeferredLoadBoundary/)
})

test('Commission approval controls share wrapping actions and keyboard-readable bounded JSON', () => {
  const panel = source('CommissionMcpApprovalPanel.tsx')
  const readers = [...panel.matchAll(/<pre ([^>]+)>/g)]
  assert.equal(readers.length, 5)
  for (const reader of readers) assert.match(reader[1]!, /namedReadRegionProps/, 'every bounded JSON reader is keyboard named')
  const actions = [...panel.matchAll(/<div data-commission-mcp-actions className=\{([^}]+)\}/g)]
  assert.equal(actions.length, 2)
  for (const action of actions) assert.match(action[1]!, /FORM_ACTION_GROUP_CLASS/)
  assert.match(panel, /FORM_INPUT_CLASS/)
  assert.match(panel, /<CheckboxRow/)
})

test('local Commission review starts unchecked and gates submission separately from setup consent', () => {
  const panel = source('CommissionMcpApprovalPanel.tsx')
  assert.match(panel, /\[localProgramsAcknowledged, setLocalProgramsAcknowledged\] = useState\(false\)/)
  assert.match(panel, /setLocalProgramsAcknowledged\(false\)/)
  assert.match(panel, /request\.approval\.localPrograms && !localProgramsAcknowledged/)
  assert.match(panel, /frozen\.approval\.localPrograms && !localProgramsAcknowledged/)
  assert.match(panel, /<CheckboxRow checked=\{localProgramsAcknowledged\}/)
  assert.match(panel, /normal OS access and possible startup effects/)
  assert.match(panel, /claim\.transport === 'stdio'/)
})
