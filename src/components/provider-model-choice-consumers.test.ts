import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import { filesUnder, read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('explicit model selectors share provider-derived model choices', () => {
  const consumers = [
    ['NewDispatchDialog.tsx', /const modelChoices = providerModelChoices\(provider\)/, /modelChoices\.some\(\(model\) => model\.id === modelId\)/, /modelChoices\.map\(\(model\) =>/],
    ['ProjectWorkDraftPanel.tsx', /const selectedModelChoices = providerModelChoices\(selectedProvider\)/, /providerModelChoices\(provider\)\.length > 0/, /heldModelId && !selectedModelChoices\.some/, /selectedModelChoices\.map\(\(model\) =>/],
    ['ContributionMcpDraftHelper.tsx', /const selectedModelChoices = providerModelChoices\(selectedProvider\)/, /providerModelChoices\(provider\)\.length > 0/, /held\?\.mcpProposal && !selectedModelChoices\.some/, /selectedModelChoices\.map\(\(candidate\) =>/],
    ['CommissionMcpApprovalPanel.tsx', /providerModelChoices\(provider\)\.length > 0/, /const selectedModelChoices = providerModelChoices\(selectedProvider\)/, /selectedModelChoices\.find\(model => model\.id === selectedModelId\)/, /selectedModelChoices\.map\(model =>/],
    ['ModelPickerMenuBody.tsx', /const catalog = providerModelChoices\(provider\)/, /catalog\.map\(\(m\) =>/],
  ] as const

  const explicitSelectors = filesUnder('src').filter((path) => path.endsWith('.tsx') &&
    /Choose a model/.test(stripComments(read(path)))).map((path) => basename(path)).sort()
  assert.deepEqual(explicitSelectors, consumers.map(([file]) => file).filter((file) => file !== 'ModelPickerMenuBody.tsx').sort(),
    'every explicit model chooser belongs to this enumeration, not just the original four')

  for (const [filename, ...checks] of consumers) {
    const source = stripComments(read(join(ROOT, 'src', 'components', filename)))
    for (const check of checks) assert.match(source, check, `${filename} must use canonical provider model choices`)
    if (filename !== 'ModelPickerMenuBody.tsx') assert.match(source, /Choose a model/)
  }
  const projection = stripComments(read(join(ROOT, 'src', 'lib', 'models.ts')))
  assert.match(projection, /return providerModelSelection\(provider, pick\?\.modelId\)\.model/,
    'displayed model metadata delegates to the shared exact-selection resolver')
  const contract = stripComments(read(join(ROOT, 'contract/providers.ts')))
  const selection = contract.slice(contract.indexOf('export function providerModelSelection('))
  assert.match(selection, /const catalog = providerModelChoices\(provider\)/,
    'exact selection resolves against the same derived choices as explicit selectors')
  assert.match(selection, /catalog\.find\(candidate => candidate\.id === id\)/)
  assert.doesNotMatch(selection, /catalog\[0\]/,
    'the shared resolver cannot substitute the first catalog row for a missing identity')
})
