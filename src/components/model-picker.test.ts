/** ── The one model-picker funnel (form follows function) ──────────────────────
 *  Three surfaces pick a model — the composer's Model control, a routine's model
 *  picker, and Customize's "Default model" — and they must be the SAME menu:
 *  src/components/ModelPickerMenuBody.tsx renders provider → model → effort entirely
 *  from the live provider registry — each provider's OWN catalog
 *  (`ModelProvider.models`), never a client constant (spec MODEL-13's "registered
 *  once, pickable everywhere", now including the default provider's models).
 *  These lock the funnel: no model/effort catalog constant survives anywhere in
 *  src/, the menu reads the registry hook, and all three pickers consume it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from '../../tests/helpers/source.ts'

test('no client-side model catalog constant exists — the registry is the only source', () => {
  // The old drift vector: a `MODELS = [...]` / `EFFORTS = [...]` constant in the
  // UI that a registry change can't reach. The models the pickers list must come
  // from `ModelProvider.models` (via useProviders), so no src/ file may declare a
  // model-catalog literal (a model id string paired with a hardcoded list shape).
  const offenders = filesUnder('src')
    .filter((f) => /(?:const|export const)\s+(MODELS|EFFORTS)\s*[:=]/.test(stripComments(read(f))))
    .map((f) => f.slice(ROOT.length + 1))
  assert.deepEqual(offenders, [], 'no file re-hardcodes a model/effort catalog constant')
})

test('all three model pickers render through the shared menu', () => {
  for (const rel of ['src/components/ModelEffortControl.tsx', 'src/components/SectionView.tsx']) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'\.\/ModelPickerMenu'/, `${rel} imports the shared menu`)
    assert.ok(src.includes('<ModelPickerMenu'), `${rel} renders <ModelPickerMenu>`)
  }
  // SectionView carries two of the three (the routine picker + the Customize default).
  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.ok((section.match(/<ModelPickerMenu/g) ?? []).length >= 2, 'SectionView renders both its pickers through it')
})

test('the shared catalog loads on demand with local loading and explicit failure recovery', () => {
  const source = stripComments(read(join(ROOT, 'src/components/ModelPickerMenu.tsx')))
  assert.doesNotMatch(source, /import\s+\{\s*ModelPickerMenuBody\s*\}\s+from/,
    'the catalog body must not join the closed composer startup graph')
  assert.match(source, /lazy\(\(\)\s*=>\s*import\('\.\/ModelPickerMenuBody'\)/)
  assert.match(source, /<Suspense fallback=\{<div role="status" data-model-picker-loading/)
  assert.match(source, /getDerivedStateFromError[\s\S]*role="alert" data-model-picker-load-error/)
  assert.match(source, /Copy any unsent text before reloading\./)
  assert.match(source, /window\.location\.reload\(\)/,
    'a stale deployment can recover with fresh asset URLs')
  assert.match(source, /export function OnlineDot\(/, 'closed toolbar liveness stays eager')
})

test('unattended routines bind structured endpoint choices and exclude Session providers', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const routine = section.slice(section.indexOf('function ModelPanel('), section.indexOf('function DispatchView('))
  assert.ok(routine.includes('endpointOnly'), 'the routine picker excludes foreground Session providers')
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'ModelPickerMenuBody.tsx')))
  assert.ok(menu.includes("candidate.kind !== 'session'"), 'legacy kind absence remains an endpoint, not an empty picker')
  assert.ok(routine.includes('setAgentId(event.currentTarget.value)'), 'the routine stages an explicit Agent id')
  assert.ok(routine.includes('providerId: pick.providerId'), 'Apply writes an explicit provider id')
  assert.ok(routine.includes('modelId: pick.modelId'), 'Apply writes an explicit model id')
  assert.ok(routine.includes('effort: effort'), 'Apply writes explicit effort')
  assert.match(routine, /await commit\(\s*\{[\s\S]*agentId[\s\S]*providerId[\s\S]*modelId[\s\S]*effort/,
    'the complete unattended execution binding lands in one acknowledged patch')
  assert.doesNotMatch(routine, /onPick(?:Model|Effort|Provider)=\{[^}]*commit/,
    'picker gestures stage locally rather than emitting partial writes')
  assert.doesNotMatch(routine, /updateSchedule\([^)]*,\s*\{\s*model:/,
    'the display label is not the execution routing field')
})

test('the shared menu reads the LIVE provider registry, not a snapshot constant', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'ModelPickerMenuBody.tsx')))
  assert.match(src, /useProviders\(\)/, 'the registry hook feeds the menu directly')
  // The model rows are the selected provider's own catalog, projected through the
  // shared pure helpers — not a local list.
  assert.match(src, /pickedProvider\(/, 'provider resolution goes through the shared projection')
  assert.match(src, /pickedModel\(/, 'model resolution goes through the shared projection')
})

test('an endpoint with no catalog-declared effort vocabulary exposes no effort choices', () => {
  const modelProjection = stripComments(read(join(ROOT, 'src', 'lib', 'models.ts')))
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'ModelPickerMenuBody.tsx')))
  assert.match(modelProjection, /model\?\.effortLevels \?\? provider\?\.effortLevels \?\? \[\]/,
    'unknown provider effort metadata remains an empty vocabulary')
  assert.match(menu, /\{levels\.length > 0 && \(/,
    'effort buttons are rendered only when the selected catalog declares levels')
  assert.match(menu, /\{levels\.length === 0 && \(/,
    'an empty vocabulary receives the existing no-effort explanation')
})

test('the composer gates BOTH pick levels on the session write path (no silent prefs rewrite)', () => {
  // With no server row to write (onSelectModel absent), the menu's rows render
  // read-only — a click must not silently rewrite the shared default-model
  // preference while visibly doing nothing (the review-found escape).
  const src = stripComments(read(join(ROOT, 'src', 'components', 'ModelEffortControl.tsx')))
  assert.match(src, /onPickModel=\{onSelectModel &&/, 'the model rows are gated on the write path')
  assert.match(src, /onPickProvider=\{onSelectModel &&/, 'the provider rows are gated on the write path')
})

test('the API-endpoint provider form collects and sends the connection it claims to create', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'ProviderDialogs.tsx')))
  for (const field of ['Endpoint URL', 'Model ID', 'Credential variable (optional)']) {
    assert.ok(src.includes(field), `the endpoint form exposes ${field}`)
  }
  assert.ok(
    src.includes('config: {') && src.includes('baseURL: baseURL.trim()') && src.includes('apiKeyEnv: apiKeyEnv.trim()'),
    'the endpoint fields travel through the write-only provider config',
  )
  assert.ok(src.includes('The selected protocol is verified before it is saved.'), 'the form explains its protocol-specific probe boundary')
  assert.ok(src.includes('title="Update connection"'), 'a private endpoint exposes its connection lifecycle after creation')
  assert.ok(src.includes('blank fields remain unchanged'), 'the replacement form explains its partial write-only semantics')
})

test('composer and provider surfaces project the server-computed execution posture', () => {
  const conversation = stripComments(read(join(ROOT, 'src', 'components', 'ConversationView.tsx')))
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'ModelPickerMenuBody.tsx')))
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.ok(conversation.includes('composerExecutionState('), 'the selected provider gates composition')
  assert.ok(conversation.includes('executionState={execution}'), 'the exact same resolved decision feeds the composer explanation')
  assert.ok(conversation.includes('providersQ.data !== undefined && provider === undefined'), 'known provider absence cannot be confused with loading')
  const composer = stripComments(read(join(ROOT, 'src/components/Composer.tsx')))
  assert.ok(composer.includes('executionState: ComposerExecutionState'), 'the shared decision is required')
  assert.doesNotMatch(composer, /composerExecutionState\(/, 'the composer cannot infer a second posture')
  assert.ok(menu.includes("p.execution === 'unconfigured'"), 'the shared picker explains blocked providers')
  assert.ok(section.includes("provider.execution === 'unconfigured'"), 'the canonical Models surfaces show status')
})

test('an empty model list never claims an unconfigured endpoint can run', () => {
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'ModelPickerMenuBody.tsx')))
  const emptyModelCopy = menu.slice(menu.indexOf('{catalog.length === 0 && ('), menu.indexOf('\n      </div>', menu.indexOf('{catalog.length === 0 && (')))
  assert.match(emptyModelCopy, /provider\.execution === 'unconfigured'/)
  assert.match(emptyModelCopy, /turns are blocked before they are written/)
  assert.match(emptyModelCopy, /Choose a provider to see its model choices/)
  assert.match(emptyModelCopy, /provider\.execution === 'unconfigured'[\s\S]*turns are blocked before they are written[\s\S]*provider\.execution === 'mock'[\s\S]*turns run its configured model/,
    'the configured-model claim is reached only after unconfigured and mock states are handled')
})

test('the longer endpoint workflow stays inside the shared scroll-bounded form dialog', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(section, /import \{ FormDialog, FormField \} from '\.\/FormDialog\.tsx'/,
    'endpoint workflows retain the shared form shell')
  const src = stripComments(read(join(ROOT, 'src', 'components', 'FormDialog.tsx')))
  assert.ok(src.includes('BOUNDED_DIALOG_PANEL_CLASS'), 'the dialog composes the shared viewport-bounded panel')
  assert.ok(src.includes('useBoundedDialog(dialogRef)'), 'the dialog follows the available workspace below shell notices')
  assert.ok(src.includes('BOUNDED_DIALOG_BODY_CLASS'), 'only the shared form body scrolls')
  assert.ok(src.includes('flex shrink-0 items-center justify-between border-b'), 'the dialog header remains visible')
  assert.ok(src.includes('flex shrink-0 items-center justify-end gap-2 border-t'), 'the dialog actions remain visible')
})
