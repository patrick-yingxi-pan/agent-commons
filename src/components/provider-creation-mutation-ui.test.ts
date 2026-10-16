import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('provider onboarding is one acknowledgement-owned form and credential ceremony', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const dialogs = stripComments(read(join(ROOT, 'src', 'components', 'ProviderDialogs.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredProviderDialogs.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'providerCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'providerCreationMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProviderCreationMutationNotice.tsx')))
  const defaults = stripComments(read(join(ROOT, 'src', 'lib', 'providerSetup.ts')))

  assert.match(view, /DeferredProviderDialog[\s\S]*onCreated=\{providerCreated\}/, 'the page opens the deferred first-run form')
  assert.doesNotMatch(view, /import \{ ProviderDialog \}/, 'the large pane does not eagerly import provider forms')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ProviderDialogs\.tsx'\)[\s\S]*<Dialog \{\.\.\.props\} \/>/, 'provider form code is an on-demand module')
  assert.match(deferred, /role=\{failed \? 'alert' : 'status'\}[\s\S]*data-provider-form-load=\{failed \? 'failed' : 'loading'\}/, 'loading/failure is announced in a provider-owned state')
  assert.match(deferred, /submitLabel=\{failed \? 'Reload app' : 'Loading…'\}[\s\S]*onSubmit=\{\(\) => window\.location\.reload\(\)\}[\s\S]*Copy any unsent workspace text before reloading/, 'a failed chunk has explicit no-mutation recovery')
  assert.doesNotMatch(dialogs, /createProvider\(/, 'the dialog cannot bypass acknowledged creation')
  assert.equal(
    (dialogs.match(/enqueueProviderCreation\(\{/g) ?? []).length,
    2,
    'endpoint and Session providers enter the same controller',
  )
  assert.match(dialogs, /busy=\{busy\}/, 'the shared dialog freezes the exact submitted fields')
  assert.match(dialogs, /Your provider details are still here/, 'Dismiss preserves the authored form')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'one form submission owns one logical identity')
  assert.match(controller, /captureProviderCreationSource/, 'the activation account is frozen before native or transport work')
  assert.doesNotMatch(controller, /import\(/, 'provider submission cannot depend on a newly fetched runtime chunk')
  assert.match(controller, /createAcknowledgedActionMutationController/, 'one ready queue owns creation and recovery')
  assert.doesNotMatch(controller, /discardProviderCreationResources/, 'Dismiss cannot delete a key while an aborted request may still commit')
  assert.match(commands, /providerCreationId\(intent\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped row')
  assert.match(commands, /represented\.kind === 'session'[\s\S]*apiPost<CreatedProvider>/, 'Session reconciliation recovers the same-key one-time secret')
  assert.match(controller, /prepareProviderCreationCredential\(intent, credentials\)[\s\S]*applyProviderCreation/, 'the vault reference exists before the server probe')
  assert.match(controller, /bindProviderCreationCredential\(intent, provider\.id, credentials\)/, 'only acknowledged server identity binds the key')
  assert.match(controller, /definitelyUnapplied[\s\S]*discardProviderCreationCredential/, 'only a definitive refusal discards before user recovery')
  assert.match(notice, /kind="provider-create"/, 'uncertainty has one shell-owned recovery surface')
  assert.match(dialogs, /Provider preset[\s\S]*Custom[\s\S]*Claude \/ Anthropic[\s\S]*OpenAI[\s\S]*DeepSeek/,
    'first-party setup offers the three protocols and an editable custom path')
  assert.match(defaults, /https:\/\/api\.deepseek\.com\/anthropic[\s\S]*deepseek-flash/,
    'DeepSeek uses its documented Anthropic-compatible base and real model ID')
  assert.match(dialogs, /config:\s*\{\s*protocol,/,
    'the selected protocol is sent with the write-only endpoint configuration')
  assert.match(dialogs, /model\.trim\(\)\.length > 0[\s\S]*model: model\.trim\(\)/,
    'endpoint creation requires and submits an explicit model ID')
  assert.match(dialogs, /provider !== null \|\| \(model\.trim\(\)\.length > 0[\s\S]*\)\)\s*&&/,
    'model-ID admission applies only to endpoint creation, not editing an existing provider')
  assert.match(dialogs, /modelFamily: family\.trim\(\), effortLevels: \[\],[\s\S]*config:/,
    'endpoint providers start with no claimed effort levels until their own catalog supplies them')
  assert.match(dialogs, /ReplyOutputLimitField value=\{replyOutputTokens\}/,
    'new endpoint setup visibly chooses its per-call reply output limit')
  assert.match(dialogs, /DEFAULT_REPLY_OUTPUT_TOKENS[\s\S]*config:\s*\{[\s\S]*replyOutputTokens/,
    'the explicit default output limit enters the acknowledged write-only configuration')
  assert.match(dialogs, /MIN_REPLY_OUTPUT_TOKENS[\s\S]*MAX_REPLY_OUTPUT_TOKENS[\s\S]*step=\{1\}/,
    'the field communicates and enforces the shared integer bounds')
  assert.match(view, /data-provider-reply-output-limit[\s\S]*provider\.replyOutputTokens/,
    'the saved Provider page displays the server-safe effective annotation')
  assert.match(dialogs, /effortLevels: \['Low', 'Medium', 'High'\],[\s\S]*kind: 'session'/,
    'the existing Session provider vocabulary remains unchanged')
  assert.match(dialogs, /providerSetupDefaults\(nextPreset\)[\s\S]*if \(!defaults\) return/,
    'Custom keeps the authored values while named presets fill editable fields')
})
