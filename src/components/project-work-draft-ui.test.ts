import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Project work Draft response is lazy, owner bounded, revision pinned, and explicit to share', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredProjectWorkDraftPanel.tsx')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'ProjectWorkDraftPanel.tsx')))
  const dispatch = stripComments(read(join(ROOT, 'src', 'api', 'dispatchCommands.ts')))
  const dispatchController = stripComments(read(join(ROOT, 'src', 'controller', 'dispatchMutations.ts')))
  const commentController = stripComments(read(join(ROOT, 'src', 'controller', 'workItemCommentCreationMutations.ts')))
  const appliedCommentHook = stripComments(read(join(ROOT, 'src', 'controller', 'useAppliedWorkItemComment.ts')))

  assert.match(section, /import \{ DeferredProjectWorkDraftPanel \} from '\.\/DeferredProjectWorkDraftPanel\.tsx'/,
    'the lightweight wrapper is eager while its detailed panel remains deferred')
  assert.match(section, /<FoldSection[\s\S]*title="Draft response"[\s\S]*<SectionAction[\s\S]*label="Draft a response"[\s\S]*<DeferredProjectWorkDraftPanel project=\{project\} item=\{o\} onOpenSession=\{onOpenSession\} onCommentPosted=/)
  assert.match(section, /projectWorkDraftHeld = !!heldProseDraftSelection \|\| commentHeld \|\| retractionHeld/,
    'the prose response panel stays closed for a separately held structured MCP argument draft')
  assert.doesNotMatch(section, /Loading response draft controls failed/)
  assert.match(section, /heldProjectWorkDraftSelection\(project\.id, workItemId\)/)
  assert.match(deferred, /const Panel = lazy\(\(\) => import\('\.\/ProjectWorkDraftPanel\.tsx'\)/,
    'the detailed draft/review implementation stays in its own lazy leaf')
  assert.match(deferred, /return <DeferredLoadBoundary fallback=\{<section[\s\S]*<Suspense fallback=/)

  assert.match(panel, /commission\.mine === true/)
  assert.match(panel, /rolePermits\(role, 'read'\)/)
  assert.doesNotMatch(panel, /candidate\.tenantId === tenantId/)
  assert.match(panel, /configurationRevision \?\? 0/)
  assert.match(panel, /provider\.kind !== 'session'/)
  assert.match(panel, /features\.dispatchExecution/)
  assert.match(panel, /query\.status === 'idle' \|\| query\.status === 'loading'/,
    'stale cached registry data is not admission-ready during revalidation')
  assert.match(panel, /const canDraft = dispatch\.available && capabilityReady && !readError && !registryLoading && !runActive/)
  assert.match(panel, /run\.execution\.state === 'running'/)
  assert.match(panel, /projectWork: source/)
  assert.match(dispatch, /const body = intent\.projectWork[\s\S]*execution: intent\.execution,[\s\S]*projectWork: intent\.projectWork,[\s\S]*\.\.\.\(intent\.mcpProposal \? \{ mcpProposal: intent\.mcpProposal \} : \{\}\)[\s\S]*\} satisfies ProjectWorkDraftInput/,
    'project-work requests carry only the frozen source, execution, and optional structured MCP selector')
  assert.match(dispatchController, /heldProjectWorkDraftSelection\(projectId: string, itemId: string\)/)
  assert.match(dispatchController, /heldIntents\.set\(intent\.intentId, intent\)/)
  assert.match(commentController, /settled === 'applied' && issuedGeneration === accountGeneration[\s\S]*appliedListeners/,
    'the mounted page learns exact applied truth without inferring it from cache')
  assert.match(appliedCommentHook, /event\.tenantId !== tenantId \|\| event\.projectId !== projectId \|\| event\.itemId !== itemId \|\| draftRef\.current !== event\.body/,
    'successful recovery clears only a composer still containing the exact submitted body')
  assert.match(section, /useAppliedWorkItemComment\(tenantId, projectId, o\.id, draft/)
  assert.match(section, /useAppliedWorkItemComment\(tenantId, project\.id, workItemId, draft/)

  assert.match(panel, /run\.tenantId === tenantId/)
  assert.match(panel, /run\.execution\?\.projectWork\?\.projectId === project\.id/)
  assert.match(panel, /run\.execution\.projectWork\.itemId === item\.id/)
  assert.match(panel, /message\.id === messageId && message\.role === 'assistant'/)
  assert.match(panel, /heldWorkItemCommentIntent\(project\.id, item\.id\)/)
  assert.match(panel, /isWorkItemRetractionHeld\(project\.id, item\.id\)/)
  assert.match(panel, /replyAvailable = !!reply && sessionQuery\.status !== 'error'/)
  assert.match(panel, /replyHydrated = replyAvailable && loadedMessageId === reply\?\.id/)
  assert.match(panel, /!replyHydrated \|\| !replyDraft\.trim\(\)/,
    'sharing also requires the exact saved reply to finish hydration')
  assert.match(panel, /\(replyHydrated \|\| commentHeld\) &&/,
    'the editable reply is hidden until source text is initialized')
  assert.match(panel, /disabled=\{shareHeld \|\| held\}/, 'the exact comment and retraction holds freeze the review editor')
  assert.match(panel, /disabled=\{shareHeld \|\| held\} onClick=\{\(\) => \{ setReviewRunId/,
    'Close review remains unavailable while a comment or retraction is unresolved')
  assert.match(panel, /disabledReview=\{shareHeld\}/)
  assert.match(panel, /enqueueWorkItemCommentCreation\(\{ tenantId, projectId: project\.id, itemId: item\.id, body: replyDraft \}\)/)
  assert.match(panel, /replyDraft\.length > WORK_ITEM_COMMENT_MAX/)
  assert.match(panel, /data-project-work-share onClick=\{\(\) => void shareReply\(\)\} disabled=\{item\.status !== 'open' \|\| !replyAvailable \|\| !reviewBody\.trim\(\) \|\| reviewBody\.length > WORK_ITEM_COMMENT_MAX/)
  assert.match(panel, /heldProviderId && !readyProviders\.some/)
  assert.match(panel, /heldModelId && !selectedProvider\?\.models\?\.some/)
  assert.doesNotMatch(panel, /maxLength=\{WORK_ITEM_COMMENT_MAX\}/,
    'the source reply remains intact for review and is never silently shortened by the editor')
  assert.match(panel, /No tools run, no work is claimed or completed/)
  assert.match(panel, /Project description and instructions visible to you/)
  assert.match(panel, /excludes linked Project contexts and other external material/)
  assert.match(panel, /Nothing is shared until you review and post it below/)
  assert.match(panel, /DOOR_CLASS/)
  assert.match(deferred, /Reloading clears unsent form text and in-memory recovery/)
  assert.match(deferred, /label: 'Reload app'/)
})
