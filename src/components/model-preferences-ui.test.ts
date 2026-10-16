import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from '../../tests/helpers/source.ts'

test('every personal model setting uses one durable controller, never mount-time browser writes', () => {
  const consumers = filesUnder('src').filter((path) => /\.(?:ts|tsx)$/.test(path) && !path.endsWith('.test.ts'))
    .filter((path) => /loadModelPrefs\(|saveModelPrefs\(|claude-ui\.composer\.modelEffort/.test(stripComments(read(path))))
  assert.deepEqual(consumers, [], 'unscoped browser settings cannot establish a personal durable preference')
  for (const file of ['ModelEffortControl.tsx', 'SectionView.tsx']) {
    const source = stripComments(read(join(ROOT, 'src/components', file)))
    assert.match(source, /updateModelPreferences/, `${file} writes the shared controller`)
    assert.match(source, /useModelPreferences\(/, `${file} reads the shared setting`)
  }
  const composer = stripComments(read(join(ROOT, 'src/components/ModelEffortControl.tsx')))
  assert.doesNotMatch(composer, /useEffect\(/, 'mounting a saved conversation is not a preference edit')
  assert.match(composer, /<ModelPickerMenu\s+disabled=\{held\}/, 'the complete menu shares the operation hold')
  assert.match(composer, /personalPreferences=\{\{\s*update: updateModelPreferences,\s*onSelectModel\s*\}\}/,
    'the lazy menu receives preference writes and the exact session write path, without a persisted config object')
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const card = section.slice(section.indexOf('function DefaultModelCard()'), section.indexOf('const SYSTEM_PROMPT_PREF_KEY'))
  assert.match(card, /<ModelPickerMenu[\s\S]*disabled=\{held\}/, 'Customize retains the same menu while held')
  const menu = stripComments(read(join(ROOT, 'src/components/ModelPickerMenuBody.tsx')))
  assert.match(menu, /personalPreferences\?:\s*\{\s*update:/, 'the lazy menu takes only the personal preference writer')
  assert.match(menu, /onSelectModel\?:\s*\(pick: ModelPick\)/, 'the preference bridge preserves the caller-owned session write')
  assert.doesNotMatch(menu, /\bmodes\b|ModelModeToggles/, 'the deleted execution-mode surface is not kept in the lazy menu')
  assert.match(menu, /onSelect=\{disabled \? undefined/, 'held providers remain visible disabled')
  assert.match(menu, /!disabled && onPickModel \?/, 'held model rows remain visible disabled')
  assert.match(menu, /disabled=\{disabled \|\| !onPickEffort\}/, 'held effort rows remain visible disabled')
  const choices = menu.match(/<button\b[\s\S]*?<\/button>/g) ?? []
  assert.equal(choices.length, 2, 'both provider/model rows and effort choices are enumerated')
  for (const choice of choices) {
    assert.ok(choice.includes('data-model-choice'), 'every choice has a rendered audit stamp')
    assert.ok(choice.includes('DISABLED_CONTROL_CLASS'), 'disabled choices visibly differ from writable ones')
  }
  const button = read(join(ROOT, 'src/lib/button.ts'))
  assert.match(button, /export const DISABLED_CONTROL_CLASS =\s*'disabled:cursor-not-allowed disabled:opacity-50'/)
})

test('rendered production TSX cannot read or write persisted Fast/Ultracode modes or promise them', () => {
  const productionTsx = filesUnder('src')
    .filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'))
  for (const component of ['ModelEffortControl.tsx', 'ModelPickerMenuBody.tsx', 'SectionView.tsx']) {
    assert.ok(productionTsx.includes(join(ROOT, 'src/components', component)), `${component} is scanned`)
  }
  const modeField = /(?:\.\s*(?:fast|ultracode)\b|\[\s*['"](?:fast|ultracode)['"]\s*\]|\b(?:fast|ultracode)\s*:|\{[^{}]*\b(?:fast|ultracode)\b[^{}]*\}\s*=\s*[\w$]+)/i
  const unsupportedPromise = /\b(?:Fast output|Ultracode)\b/i
  const offenders = productionTsx.filter((path) => {
    const source = stripComments(read(path))
    return modeField.test(source) || unsupportedPromise.test(source)
  }).map((path) => path.slice(ROOT.length + 1))
  assert.deepEqual(offenders, [], 'rendered UI has no persisted mode access or unsupported mode promise')
  assert.ok(!productionTsx.some((path) => path.endsWith('/ModelModeToggles.tsx')),
    'the unsupported Fast/Ultracode toggle component is removed')
})

test('workspace hydration and untouched drafts cannot guess an unread preference', () => {
  const gate = stripComments(read(join(ROOT, 'src/components/ModelPreferencesGate.tsx')))
  assert.match(gate, /if \(!query\.data\)\s*\{[\s\S]*AppBootstrapScreen[\s\S]*onRetry=\{retryModelPreferencesRead\}/)
  const app = stripComments(read(join(ROOT, 'src/App.tsx')))
  assert.match(app, /<ModelPreferencesGate key=\{`\$\{resolvedIdentity\.user\.id\}:\$\{resolvedIdentity\.tenant\.id\}`\}>\s*<Workspace/)
  const pane = stripComments(read(join(ROOT, 'src/components/ConversationPane.tsx')))
  assert.match(pane, /conv\.draftBinding \?\? \{\s*providerId: preferences\.providerId,\s*modelId: preferences\.modelId/)
})

test('a crossed startup identity offers full reload, not a preference-only retry loop', () => {
  const gate = stripComments(read(join(ROOT, 'src/components/ModelPreferencesGate.tsx')))
  assert.match(gate, /query\.error instanceof AccountSwitchedError[\s\S]*status="account-changed"[\s\S]*window\.location\.reload\(\)/)
  const screen = read(join(ROOT, 'src/components/AppBootstrapScreen.tsx'))
  assert.match(screen, /Reload to continue with the account that is signed in now\./)
})
