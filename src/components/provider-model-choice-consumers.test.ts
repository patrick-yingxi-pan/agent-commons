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
  assert.match(projection, /const catalog = providerModelChoices\(provider\)/)
})
