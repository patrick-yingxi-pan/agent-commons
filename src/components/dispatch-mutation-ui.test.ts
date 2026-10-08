import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function dispatchDialog(source: string): string {
  const start = source.indexOf('function NewDispatchDialog(')
  const end = source.indexOf('function ScheduledSection(', start)
  assert.ok(start >= 0 && end > start, 'the source contains the complete Dispatch dialog')
  return source.slice(start, end)
}

function assertExactDispatchBinding(source: string): void {
  assert.match(source, /const input = \{[\s\S]*title: title\.trim\(\),[\s\S]*detail: detail\.trim\(\) \|\| undefined,[\s\S]*execution: \{ agentId, providerId, modelId \},[\s\S]*enqueueDispatch\(input\)/,
    'the task and exact reviewed Agent/provider/model enter one held logical action')
  assert.match(source, /<FormField label="Agent">[\s\S]*value=\{agentId\}[\s\S]*value=\{agent\.id\}/,
    'the selected Agent remains an explicit choice')
  assert.match(source, /<FormField label="Model connection">[\s\S]*value=\{providerId\}[\s\S]*filter\(\(candidate\) => candidate\.kind !== 'session'\)\.map\(\(candidate\) =>[\s\S]*value=\{candidate\.id\}/,
    'only endpoint model connections can be selected')
  assert.match(source, /<FormField label="Model">[\s\S]*value=\{modelId\}[\s\S]*value=\{model\.id\}/,
    'the concrete model is selected within the chosen provider')
  assert.match(source, /const canCreate = dispatch\.available && Boolean\(bindingReady\) && title\.trim\(\)\.length > 0 && Boolean\(tenantId\)/)
}

function assertNoRawSnapshotMerge(command: string): void {
  assert.match(command, /await apiPost<DispatchRun>\([\s\S]*\{ idempotencyKey \},/,
    'one acknowledged keyed POST owns the operation')
  assert.match(command, /await apiPost<DispatchRun>[\s\S]*?\n\s*invalidate\(keys\.dispatch\)[\s\S]*invalidate\(keys\.sessions\)/,
    'acknowledgement invalidates authoritative feed and session reads')
  assert.match(command, /const incoming = await apiGet<DispatchRun\[]>\(paths\.dispatch\)[\s\S]*invalidate\(keys\.dispatch\)[\s\S]*return !baseline\.runIds\.includes\(expectedId\) && incoming\.some\(\(run\) => run\.id === expectedId\)/,
    'uncertain recovery proves the exact expected identity from a fresh GET')
  assert.doesNotMatch(command, /mergeAcknowledgedDispatchRun|mergeDispatchSnapshot|mutate<DispatchRun\[]>/,
    'a delayed mutation snapshot must not resurrect a deleted run or rewind terminal state')
}

function assertDispatchUiContract(view: string, command: string): void {
  const dialog = dispatchDialog(view)
  assert.doesNotMatch(view, /createDispatch\(/, 'the dialog cannot bypass acknowledgement')
  assert.match(view, /dispatchPresentation\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/,
    'the page reads the independent real-execution capability')
  assert.match(view, /const openDispatch = \(\) => \{ if \(dispatch\.available\) setCreating\(true\) \}/)
  assert.match(view, /disabled=\{!dispatch\.available\}/)
  assert.match(view, /onRailInvoke=\{dispatch\.available \? openDispatch : undefined\}/)
  assertExactDispatchBinding(dialog)
  assert.match(dialog, /outcome === 'applied'/, 'only an acknowledged creation closes the dialog')
  assert.match(dialog, /busy=\{held\}/, 'the shared form freezes exact choices while uncertain')
  assert.match(dialog, /if \(!canCreate \|\| held \|\| !tenantId\) return/)
  assert.match(dialog, /canSubmit=\{canCreate && !held\}/)
  assertNoRawSnapshotMerge(command)
}

test('Dispatch creation holds the exact task and execution binding through acknowledgement/recovery', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const command = stripComments(read(join(ROOT, 'src', 'api', 'dispatchCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'dispatchMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'dispatchMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DispatchMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assertDispatchUiContract(view, command)
  assert.match(controller, /import\('\.\/dispatchMutationRuntime'\)/, 'low-frequency transport remains lazy')
  assert.match(controller, /issuedGeneration !== accountGeneration/, 'an old account cannot release the new account hold')
  assert.match(runtime, /createAcknowledgedActionMutationController/, 'Dispatch reuses the acknowledged-action FIFO')
  assert.match(runtime, /reconcile: reconcileDispatch/)
  assert.match(notice, /kind="dispatch-create"/, 'uncertainty has one shell recovery role')
  assert.match(shell, /<DispatchMutationNotice\s*\/>/, 'Dispatch recovery mounts once at shell scope')
})

test('Dispatch locks reject losing the exact execution choice or projecting stale response snapshots', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const command = stripComments(read(join(ROOT, 'src', 'api', 'dispatchCommands.ts')))
  assertDispatchUiContract(view, command)

  const noModelBinding = view.replace('execution: { agentId, providerId, modelId },', 'execution: { agentId, providerId },')
  assert.notEqual(noModelBinding, view, 'the mutation fixture changes the binding')
  assert.throws(() => assertExactDispatchBinding(dispatchDialog(noModelBinding)), /exact reviewed Agent\/provider\/model/)

  const staleProjection = command.replace(
    'invalidate(keys.dispatch)\n  invalidate(keys.sessions)',
    'mutate<DispatchRun[]>(keys.dispatch, (current) => mergeAcknowledgedDispatchRun(current, run))',
  )
  assert.notEqual(staleProjection, command, 'the mutation fixture restores an unsafe optimistic merge')
  assert.throws(() => assertNoRawSnapshotMerge(staleProjection), /delayed mutation snapshot/)
})
