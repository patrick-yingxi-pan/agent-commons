/** Section pages are a real on-demand feature boundary: a conversation boot
 * must not eagerly evaluate the 14k-line all-sections surface. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('proposal review loads only for proposal messages and failure grants no decision authority', () => {
  const message = stripComments(read(join(ROOT, 'src/components/Message.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredRelationActionCard.tsx')))
  const check = (source: string) => {
    assert.match(source, /from '\.\/DeferredRelationActionCard'/)
    assert.doesNotMatch(source, /from '\.\/RelationActionCard'/)
  }
  check(message)
  assert.throws(() => check(message.replaceAll("from './DeferredRelationActionCard'", "from './RelationActionCard'")), assert.AssertionError)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/RelationActionCard\.tsx'\)/)
  assert.match(deferred, /DeferredLoadBoundary[\s\S]*data-relation-action-load-error[\s\S]*No decision was made/)
  assert.match(deferred, /Copy unsent workspace text before reloading[\s\S]*window\.location\.reload\(\)[\s\S]*Reload proposal review/)
  assert.match(deferred, /Suspense[\s\S]*data-relation-action-loading[\s\S]*<Card \{\.\.\.props\}/)
  assert.doesNotMatch(deferred, /enqueueRelationActionDecision|onConfirm|onDecline|onApprove/)
})

test('resource Improvements loads behind its page section without offering consent in its fallback', () => {
  for (const file of ['SectionView.tsx', 'artifactPreview.tsx']) {
    const source = stripComments(read(join(ROOT, 'src/components', file)))
    assert.match(source, /DeferredProposalsPanel as ProposalsPanel/)
    assert.doesNotMatch(source, /import \{ ProposalsPanel[, }]/)
  }
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredProposalsPanel.tsx')))
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ProposalsPanel\.tsx'\)/)
  assert.match(deferred, /<Section title="Improvements"[\s\S]*heldOpen/)
  assert.match(deferred, /data-proposals-load=\{failed \? 'error' : 'loading'\}/)
  assert.match(deferred, /No change was offered or decision made[\s\S]*Copy unsent workspace text before reloading/)
  assert.match(deferred, /Reload improvements[\s\S]*window\.location\.reload/)
  assert.match(deferred, /DeferredLoadBoundary[\s\S]*Suspense[\s\S]*<Panel \{\.\.\.props\}/)
  assert.doesNotMatch(deferred, /enqueueSocialProposalCreation|onConfirm|onDecline|onApprove/)
})

test('usage gauge remains eager while the details body loads only on first open', () => {
  const control = stripComments(read(join(ROOT, 'src/components/UsageControl.tsx')))
  const details = stripComments(read(join(ROOT, 'src/components/UsageDetails.tsx')))
  assert.match(control, /import \{ withLiveMessages, type UsageModelRef, type UsageSnapshot \} from '\.\.\/\.\.\/contract\/usage\.ts'/,
    'the server snapshot and live message overlay remain owned by the gauge controller')
  assert.match(control, /const UsageDetails = lazy\(\(\) => import\('\.\/UsageDetails'\)/,
    'the explanatory rows do not enter the composer cold graph')
  assert.match(control, /<UsageGauge usage=\{usage\} \/>/,
    'the always-visible gauge stays in the eager module')
  assert.match(control, /open && \([\s\S]*<DeferredLoadBoundary fallback=\{<UsageDetailsFallback failed[\s\S]*<Suspense[\s\S]*<UsageDetails/,
    'detail loading begins only when the popup opens')
  assert.match(control, /data-usage-details-load=\{failed \? 'error' : 'loading'\}/)
  assert.match(control, /function UsageDetailsFallback[\s\S]*const popRef = usePopoverShift\(true\)[\s\S]*<div ref=\{popRef\} role="dialog"/,
    'the loading and failed faces own shared containment, not just the deferred body')
  assert.match(control, /role=\{failed \? 'alert' : 'status'\}[\s\S]*Couldn’t display usage details[\s\S]*>Close</,
    'a failed detail chunk is announced and has a local Close fallback')
  assert.match(control, /Copy unsent text before reloading[\s\S]*window\.location\.reload\(\)[\s\S]*Reload usage details/,
    'cached module failure has explicit warned full-reload recovery')
  assert.match(details, /Context estimate[\s\S]*About 4 characters per token[\s\S]*Local usage limits/,
    'the lazy content retains the existing estimate and limits explanation')
})

test('routine cadence editor and its option catalog load only after opening Schedule edit', () => {
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredCadenceEditor.tsx')))
  const loadState = deferred.slice(deferred.indexOf('function CadenceEditorLoadState('), deferred.indexOf('export function DeferredCadenceEditor('))
  const editor = stripComments(read(join(ROOT, 'src/components/CadenceEditor.tsx')))
  const hook = stripComments(read(join(ROOT, 'src/controller/useScheduleDraftCommit.ts')))
  assert.match(section, /import \{ DeferredCadenceEditor \} from '\.\/DeferredCadenceEditor\.tsx'/)
  assert.match(section, /editing && <DeferredCadenceEditor[\s\S]*task=\{task\}[\s\S]*commit=\{commit\}/)
  assert.doesNotMatch(section, /import \{\s*CadenceEditor\s*\} from/)
  assert.doesNotMatch(section, /const FREQ_OPTIONS|const TIMEZONES|function CadenceEditor\(/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/CadenceEditor'\)/)
  assert.match(deferred, /DeferredLoadBoundary[\s\S]*Suspense[\s\S]*<Editor \{\.\.\.props\}/)
  assert.match(deferred, /useDismissable<HTMLDivElement>\(true, props\.onClose\)[\s\S]*usePopoverShift<HTMLDivElement>\(true\)[\s\S]*<div ref=\{panelRef\} role="dialog"[\s\S]*<DeferredLoadBoundary[\s\S]*<Suspense/,
    'dismissal and viewport geometry stay attached to one stable shell across fallback/body replacement')
  assert.equal((deferred.match(/role="dialog"/g) ?? []).length, 1,
    'only the stable deferred shell owns the dialog and geometry ref')
  assert.doesNotMatch(loadState, /ref=\{panelRef\}/,
    'a Suspense/error fallback cannot steal the open-only viewport observer')
  assert.match(deferred, /data-cadence-editor-load=\{failed \? 'error' : 'loading'\}/)
  assert.match(deferred, /role=\{failed \? 'alert' : 'status'\}/)
  assert.match(deferred, /Copy any unsent workspace text before reloading[\s\S]*Reload app[\s\S]*Close/)
  assert.match(editor, /export function CadenceEditor/)
  assert.match(editor, /FREQ_OPTIONS[\s\S]*TIMEZONES[\s\S]*await commit\(/)
  assert.doesNotMatch(editor, /panelRef|popoverClassName/,
    'the lazy leaf no longer receives shell refs or duplicated visual primitives')
  assert.match(deferred, /Editor \{\.\.\.props\} softButtonClass=\{SOFT_BUTTON_CLASS\}/,
    'the shared button recipe remains owned by the shell')
  assert.doesNotMatch(editor, /role="dialog"|data-cadence-editor-shell/,
    'the loaded editor body cannot replace or nest the stable dialog shell')
  assert.match(section, /function SchedulePanel[\s\S]*useScheduleDraftCommit\([\s\S]*'schedule'[\s\S]*<DeferredCadenceEditor[\s\S]*task=\{task\}[\s\S]*busy=\{busy\}[\s\S]*commit=\{commit\}/)
  assert.match(hook, /export function useScheduleDraftCommit\([\s\S]*update\(scheduleId, patch, expectedRevision\)/)
  assert.doesNotMatch(editor, /from ['"]\.\/SectionView/)
  assert.doesNotMatch(editor, /from ['"]\.\.\/controller\/scheduleMutations/,
    'the async leaf receives its acknowledged command instead of importing through its parent chunk')
  assert.doesNotMatch(editor, /from ['"]\.\.\/lib\/(?:popover|useDismissable|usePopoverShift)|from ['"]\.\/SectionView/,
    'the async leaf has no runtime edge back into the large SectionPane graph')
})

test('account menu content loads only after opening the always-visible chip', () => {
  const sidebar = stripComments(read(join(ROOT, 'src/components/Sidebar.tsx')))
  const chip = stripComments(read(join(ROOT, 'src/components/AccountChip.tsx')))
  const menu = stripComments(read(join(ROOT, 'src/components/AccountMenu.tsx')))
  assert.match(sidebar, /import \{ AccountChip \} from '\.\/AccountChip'/)
  assert.doesNotMatch(sidebar, /from '\.\/AccountMenu'/)
  assert.match(chip, /const MenuContent = lazy\(\(\) => import\('\.\/AccountMenu'\)/)
  assert.match(chip, /open &&[\s\S]*<DeferredLoadBoundary fallback=\{<AccountMenuLoadState failed[\s\S]*<Suspense/,
    'the first click opens an announced shell before the menu chunk is ready')
  assert.match(chip, /data-account-menu-load=\{failed \? 'error' : 'loading'\}/)
  assert.match(chip, /<DeferredLoadBoundary fallback=\{<AccountMenuLoadState failed[\s\S]*<Suspense/,
    'chunk failure remains inside the shared account-controls boundary')
  assert.match(chip, /Couldn’t display account options\.[\s\S]*Reload account options/,
    'the failed state offers a deliberate recovery path')
  assert.match(chip, /Unsaved organization text may be lost/,
    'the reload warning covers only the unsaved text it can discard')
  assert.match(menu, /export function AccountMenuContent/)
  assert.match(menu, /fieldset disabled=\{held !== null\}/,
    'menu actions retain the existing account-transition hold')
})

test('contributor edit form loads only after its row opens and its fallback cannot save', () => {
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredCommissionDialog.tsx')))
  const dialog = stripComments(read(join(ROOT, 'src/components/CommissionDialog.tsx')))
  assert.match(section, /import \{ DeferredCommissionDialog \} from '\.\/DeferredCommissionDialog\.tsx'/)
  assert.doesNotMatch(section, /import \{ CommissionDialog \} from/)
  assert.match(section, /<DeferredCommissionDialog[\s\S]*standingNotice=\{<AutomationNotice kind="standing" \/>\}/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/CommissionDialog\.tsx'\)/)
  assert.match(deferred, /DeferredLoadBoundary[\s\S]*<Suspense[\s\S]*<Dialog \{\.\.\.props\} \/>/)
  assert.match(deferred, /data-commission-form-load=\{failed \? 'failed' : 'loading'\}/)
  assert.match(deferred, /window\.location\.reload\(\)[\s\S]*No change was made/)
  assert.doesNotMatch(deferred, /updateCommissionConfiguration|submitLabel="Save"/)
  assert.match(dialog, /updateCommissionConfiguration[\s\S]*held edits were not saved/)
  assert.match(dialog, /standingNotice/)
})

test('owner proposal review content loads on demand with a no-verdict failure state', () => {
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredAgentProposalsReviewDialog.tsx')))
  const review = stripComments(read(join(ROOT, 'src/components/AgentProposalsReviewDialog.tsx')))
  assert.match(section, /import \{ DeferredAgentProposalsReviewDialog \} from '\.\/DeferredAgentProposalsReviewDialog\.tsx'/)
  assert.doesNotMatch(section, /import \{ AgentProposalsReviewDialog \} from/)
  assert.match(section, /<DeferredAgentProposalsReviewDialog[\s\S]*Thread=\{ProposalThread\}[\s\S]*FieldDiff=\{ProposalFieldDiff\}[\s\S]*GitPullRequestIcon=\{GitPullRequest\}[\s\S]*GitMergeIcon=\{GitMerge\}/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/AgentProposalsReviewDialog\.tsx'\)/)
  assert.match(deferred, /DeferredLoadBoundary[\s\S]*<Suspense[\s\S]*<Dialog \{\.\.\.props\} \/>/)
  assert.match(deferred, /data-agent-proposal-review-load=\{failed \? 'failed' : 'loading'\}/)
  assert.match(deferred, /useBoundedDialog\(dialogRef\)[\s\S]*BOUNDED_DIALOG_LAYER_CLASS[\s\S]*BOUNDED_DIALOG_BODY_CLASS/)
  assert.match(deferred, /overflowWrap: 'anywhere'/)
  assert.match(deferred, /className=\{SCRIM_CLASS\}/)
  assert.match(deferred, /No decision was made[\s\S]*Reload proposal review/)
  assert.doesNotMatch(deferred, />Merge<|>Decline</)
  assert.match(review, /heldAgentProposalVerdictIntent[\s\S]*data-agent-proposal-verdict[\s\S]*Merge[\s\S]*Decline/)
  assert.match(review, /overflowWrap: 'anywhere'/)
  assert.match(review, /<Thread agentId=\{agent\.id\} proposal=\{proposal\}/)
  assert.match(review, /<FieldDiff fields=\{proposal\.fields\} current=\{current\}/)
  assert.match(review, /GitPullRequestIcon: LucideIcon[\s\S]*GitMergeIcon: LucideIcon/)
  assert.doesNotMatch(review, /import \{[^}]*Git(?:PullRequest|Merge)[^}]*\} from 'lucide-react'/,
    'dialog-specific icon chunks must not create a back-edge to SectionPane')
})

test('expanded Contexts rail rows load registry and native metadata behind local recovery', () => {
  const tree = stripComments(read(join(ROOT, 'src/components/SectionTreeChildren.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredContextChildren.tsx')))
  const boundary = stripComments(read(join(ROOT, 'src/components/DeferredRailChildren.tsx')))
  const inlineStatus = stripComments(read(join(ROOT, 'src/components/InlineOperationStatus.tsx')))
  const body = stripComments(read(join(ROOT, 'src/components/ContextChildren.tsx')))
  assert.doesNotMatch(tree, /import\s+\{\s*useLocalFolderConnections\s*\}\s+from/,
    'native connection metadata is absent from the eager tree graph')
  assert.match(tree, /<DeferredContextChildren\b/, 'the Contexts branch enters through its deferred shell')
  assert.match(deferred, /lazy\(\(\)\s*=>\s*import\('\.\/ContextChildren\.tsx'\)/,
    'the Contexts body is admitted only when its branch expands')
  assert.match(boundary, /data-rail-children-loading[\s\S]*Loading \$\{label\}/,
    'loading remains visible in the expanded branch')
  assert.match(deferred, /lazy\([\s\S]*DeferredRailChildrenBoundary/)
  assert.match(boundary, /data-rail-children-load-error[\s\S]*Couldn’t load \$\{label\} rows/)
  assert.match(boundary, /<NoRowsRow>[\s\S]*<InlineOperationStatus/,
    'deferred loading and recovery use the shared empty-row container')
  assert.match(inlineStatus, /return\s*\(\s*<div\s+role=\{tone\}/,
    'the operation status requires a flow-capable host')
  assert.match(boundary, /getDerivedStateFromError/,
    'a rejected chunk has a local failure face')
  assert.match(boundary, /Reload \$\{label\}[\s\S]*window\.location\.reload\(\)/,
    'recovery is explicit and reloads the document')
  assert.match(boundary, /Copy any unsent workspace text before reloading/)
  assert.match(body, /useLocalFolderConnections\(\)/,
    'only the deferred body reads native connection metadata')
  assert.doesNotMatch(body, /captureLocalFolder|refreshLocalFolder|snapshot\(/,
    'rail expansion lists metadata without browsing or capturing folder contents')
  assert.match(body, /CollectionSectionRows/,
    'the body reuses the shared collection projection template')
  const artifactBody = stripComments(read(join(ROOT, 'src/components/ArtifactChildren.tsx')))
  const artifactDoor = stripComments(read(join(ROOT, 'src/components/DeferredArtifactChildren.tsx')))
  assert.doesNotMatch(tree, /import\s+\{\s*useTrashedArtifacts\s*\}|artifactLifecycleMutations|artifactTrashProjection/,
    'artifact lifecycle and Trash projection are absent until the branch opens')
  assert.match(tree, /<DeferredArtifactChildren\b/)
  assert.match(artifactDoor, /lazy\(\(\) => import\('\.\/ArtifactChildren\.tsx'\)/)
  assert.match(artifactBody, /artifactTrashProjection[\s\S]*CollectionSectionRowsProps/)
  assert.match(artifactBody, /renderRows: Rows/,
    'artifact rows reuse the shared rail collection renderer without a chunk cycle')
})

test('MCP setup and detail bodies stay behind cancellable lazy wrappers in SectionView', () => {
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredMcpConnectionPanel.tsx')))
  const create = stripComments(read(join(ROOT, 'src/components/DeferredMcpConnectionCreate.tsx')))
  assert.doesNotMatch(section, /import\s+\{[^}]*McpConnection(?:CreateDialog|Detail)[^}]*\}\s+from\s+['"]\.\/McpConnectionPanel/,
    'the large MCP panel is absent from the SectionPane graph')
  assert.match(section, /DeferredMcpConnectionCreateDialog/)
  assert.match(section, /DeferredMcpConnectionDetail/)
  for (const wrapper of [deferred, create]) {
    assert.match(wrapper, /lazy\(\(\) => import\('\.\/McpConnectionPanel\.tsx'\)/,
      'both low-frequency MCP bodies share the module’s deferred chunk')
    assert.match(wrapper, /getDerivedStateFromError[\s\S]*Suspense/,
      'module failures stay inside the named MCP recovery shells')
  }
  assert.doesNotMatch(create, /AtomicResourcePage|BackButton|DeferredMcpConnectionPanel/,
    'composer setup does not pull the resource-detail shell into the boot graph')
  assert.match(create, /CreateFallback[\s\S]*useFocusTrap\(dialogRef, onClose, \{ initialFocus: cancelRef \}\)[\s\S]*useBoundedDialog\(dialogRef\)[\s\S]*BOUNDED_DIALOG_LAYER_CLASS[\s\S]*Reload app[\s\S]*Cancel/,
    'create loading/error uses the shared bounded modal grammar and keeps Cancel/reload')
  assert.match(deferred, /DetailFallback[\s\S]*<AtomicResourcePage[\s\S]*<BackButton to=\{backTo\} onBack=\{onBack\} \/>[\s\S]*Reload details/,
    'detail loading/error preserves canonical page back navigation and explicit reload')
})

test('repository options enter through a dismissible lazy shell without granting context on failure', () => {
  const picker = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredRepoContextPicker.tsx')))
  assert.match(picker, /DeferredRepoContextPicker as RepoPicker/)
  assert.doesNotMatch(picker, /from ['"]\.\/RepoContextPicker/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/RepoContextPicker\.tsx'\)/)
  assert.match(deferred, /getDerivedStateFromError[\s\S]*Suspense/)
  assert.match(deferred, /data-context-repo-load=\{failed \? 'error' : 'loading'\}/)
  assert.match(deferred, /Copy unsent text before reloading/)
  assert.match(deferred, /label: 'Done', onClick: this\.props\.onClose/)
  assert.match(deferred, /label: 'Reload app', onClick: \(\) => window\.location\.reload\(\)/)
  assert.doesNotMatch(deferred, /onConfirm\(|onAdd\(/)
})

test('context browsing loads only after explicit Browse with local cancel and warned reload', () => {
  const picker = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const repo = stripComments(read(join(ROOT, 'src/components/RepoContextPicker.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredContextBrowseDialog.tsx')))
  assert.match(picker, /DeferredContextBrowseDialog as BrowseDialog/)
  assert.doesNotMatch(picker, /from ['"]\.\/ContextBrowseDialog/)
  for (const source of [picker, repo]) {
    assert.equal((source.match(/browsing && \(\s*<BrowseDialog/g) ?? []).length, 1,
      'repository and connector/MCP browsing each stay behind explicit intent')
    const browseSurface = source === repo ? source.slice(source.indexOf('<ContextCatalogNotice query={catalog} />')) : source
    assert.match(browseSurface, /(?:<ContextCatalogNotice[^>]*\/>\s*)?\{browsing && \(\s*<BrowseDialog/,
      'optional browsing recovery precedes each potentially tall recent list')
  }
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ContextBrowseDialog\.tsx'\)/)
  assert.match(deferred, /ComponentProps<typeof ContextBrowseDialog>/)
  assert.match(deferred, /data-context-browse-loading[\s\S]*tone="status"/)
  assert.match(deferred, /getDerivedStateFromError[\s\S]*data-context-browse-load-error[\s\S]*tone="alert"/)
  assert.match(deferred, /Copy any unsent text before reloading/)
  assert.match(deferred, /label: 'Cancel browsing', onClick: this\.props\.onCancel/)
  assert.match(deferred, /label: 'Reload app', onClick: \(\) => window\.location\.reload\(\)/)
  assert.doesNotMatch(deferred, /onConfirm\(/, 'loading and failure cannot attach a candidate')
})

test('served file and photo snapshot runtime loads only after opening its picker with local recovery', () => {
  const picker = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredServedFileIntake.tsx')))
  const intake = stripComments(read(join(ROOT, 'src/components/ServedFileIntake.tsx')))
  const loadingTest = stripComments(read(join(ROOT, 'e2e/served-file-intake-loading.spec.ts')))
  assert.match(picker, /DeferredServedFileIntake key=\{`\$\{active\.id\}:\$\{kind\}`\}/,
    'the selected source and Files/Photos kind own one intake lifetime')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ServedFileIntake\.tsx'\)/,
    'served read, extraction, normalization, and upload are outside the cold picker graph')
  assert.doesNotMatch(picker, /from ['"]\.\/ServedFileIntake\.tsx/)
  assert.doesNotMatch(picker, /readFsSnapshot\(/)
  assert.match(deferred, /data-served-file-intake=\{failed \? 'error' : 'loading'\}/)
  assert.match(deferred, /tone=\{failed \? 'alert' : 'status'\}/)
  assert.match(deferred, /Nothing was attached/)
  assert.match(deferred, /onClick: this\.props\.onClose/)
  assert.match(deferred, /window\.location\.reload\(\)/)
  assert.match(intake, /onAccountSwitch\(\(\) => \{ cancel\(\); setRead\(null\) \}\)/)
  assert.match(intake, /if \(intake\.current\) return/)
  assert.match(intake, /<fieldset disabled=\{disabled\}>[\s\S]*<PhotoThumb[\s\S]*disabled=\{disabled\}/)
  assert.match(intake, /<OptionRow[\s\S]*disabled=\{disabled\}/)
  assert.match(loadingTest, /served-file-intake="loading"/)
  assert.match(loadingTest, /Cancel intake/)
  assert.match(loadingTest, /Reload app/)
})

test('the Add Context category workflow stays outside the eager menu graph until a type is selected', () => {
  const menu = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredContextPickerWorkflow.tsx')))
  const workflow = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  assert.match(menu, /DeferredContextPickerWorkflow/)
  assert.match(menu, /\{activeType === null \? \([\s\S]*CONTEXT_TYPES[\s\S]*\) : \([\s\S]*<DeferredContextPickerWorkflow/,
    'the lightweight category menu and dialog chrome remain usable while step two loads')
  assert.doesNotMatch(menu, /from ['"]\.\/ContextPickerWorkflow\.tsx/,
    'the eager entry has no static edge to picker branches')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ContextPickerWorkflow\.tsx'\)/)
  assert.match(deferred, /getDerivedStateFromError[\s\S]*Suspense/)
  assert.match(deferred, /Loading context options…/)
  assert.match(deferred, /Nothing was added[\s\S]*Copy unsent text and any saved Retry context before reloading/)
  assert.match(deferred, /label: 'Done'[\s\S]*label: 'Reload app'/)
  assert.match(workflow, /type === 'folder'[\s\S]*type === 'repo'[\s\S]*type === 'connector'[\s\S]*type === 'mcp'[\s\S]*type === 'discussion'[\s\S]*type === 'files'/,
    'all step-two picker families are admitted through one optional module')
})

test('MainSplit lazy-loads SectionPane behind accessible in-pane loading and failure states', () => {
  const source = stripComments(read(join(ROOT, 'src', 'components', 'MainSplit.tsx')))
  assert.doesNotMatch(source, /import\s+\{\s*SectionPane\s*\}\s+from/, 'SectionPane must stay out of the boot graph')
  assert.match(source, /lazy\(\(\)\s*=>\s*import\('\.\/SectionPane'\)/, 'the section surface has one dynamic import boundary')
  assert.match(source, /<Suspense\s+fallback=\{<SectionLoadingState\b/, 'the lazy pane cannot blank while its chunk loads')
  assert.match(source, /role="status"/, 'the loading state is announced to assistive technology')
  assert.match(source, /data-section-loading/, 'browser checks have a stable loading-state seam')
  assert.match(source, /getDerivedStateFromError/, 'a rejected section chunk cannot crash the workspace')
  assert.match(source, /role="alert"/, 'the failed state is announced to assistive technology')
  assert.match(source, /data-section-load-error/, 'browser checks have a stable failed-state seam')
  assert.match(source, /window\.location\.reload\(\)/, 'retry reloads the document so a stale deployment gets fresh asset URLs')
})

test('desktop backup controls stay outside the general section graph until Customize opens', () => {
  const source = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  assert.doesNotMatch(source, /import\s+\{\s*DesktopDataCard\s*\}\s+from/,
    'desktop-only backup APIs are absent from the ordinary SectionPane graph')
  assert.match(source, /lazy\(\(\)\s*=>\s*import\('\.\/DesktopDataCard'\)/,
    'the local backup card is split as one cohesive optional feature')
  assert.match(source, /<Suspense\s+fallback=\{<p role="status"[^>]*>Loading backup controls…<\/p>\}>\s*<DeferredDesktopDataCard\s*\/>/,
    'opening Customize keeps a visible loading state while the optional card loads')
  assert.match(source, /<DesktopDataBoundary><Suspense/,
    'a rejected backup module does not replace the rest of Customize')
  assert.match(source, /Couldn’t load backup controls\. Your data was not changed\. Copy unsent text before reloading/,
    'reload recovery discloses unsent-text loss')
})

test('durable shell recovery stays local when its deferred chunk fails and history waits for it', () => {
  const app = stripComments(read(join(ROOT, 'src/App.tsx')))
  const shell = stripComments(read(join(ROOT, 'src/components/ShellMutationNotices.tsx')))
  const history = stripComments(read(join(ROOT, 'src/components/ArtifactHistorySection.tsx')))

  assert.match(app, /lazy\(\(\)\s*=>\s*import\('\.\/components\/ShellMutationNotices'\)/)
  assert.match(app, /<ShellMutationNoticesBoundary>[\s\S]*<Suspense fallback=\{null\}>[\s\S]*<ShellMutationNotices\s*\/>[\s\S]*<\/ShellMutationNoticesBoundary>/,
    'the outer lazy cluster sits behind the eager local failure boundary')
  assert.match(app, /class ShellMutationNoticesBoundary[\s\S]*getDerivedStateFromError[\s\S]*data-shell-recovery-load-error/,
    'a rejected initial shell chunk is caught without replacing the workspace')
  assert.match(app, /data-shell-recovery-load-error className="shrink-0[^\"]*"/,
    'the failure row reserves in-flow shell height rather than overlaying workspace content')
  assert.match(app, /InlineOperationStatus[\s\S]*tone="alert"/)
  assert.match(app, /retry details/i,
    'the explicit reload warns that memory-only retry details may be lost')
  assert.match(app, /saved state/i,
    'the explicit reload tells the person to check saved state afterward')
  assert.match(app, /unsent workspace text/i,
    'the explicit reload warns about unsent workspace text')
  assert.match(app, /label: 'Reload app'[\s\S]*window\.location\.reload\(\)/,
    'reloading is explicit and never automatic')

  assert.match(shell, /import \{ ArtifactHistoryRestoreMutationNotice \} from '\.\/ArtifactHistoryRestoreMutationNotice'/,
    'the history recovery notice shares the already-deferred shell chunk')
  assert.doesNotMatch(shell, /lazy\(\(\)\s*=>\s*import\('\.\/ArtifactHistoryRestoreMutationNotice'/,
    'no independently failing history-notice chunk can strand a held restore')
  assert.match(shell, /<ArtifactHistoryRestoreMutationNotice\s*\/>/)
  assert.match(history, /Promise\.all\([\s\S]*import\('\.\/ArtifactHistoryPanel'\)[\s\S]*import\('\.\/ShellMutationNotices'\)/,
    'history admission waits for the same shell module before mounting restore controls')
})

test('tool activity UI loads only for transcripts that contain tool activity', () => {
  const message = stripComments(read(join(ROOT, 'src', 'components', 'Message.tsx')))
  const source = stripComments(read(join(ROOT, 'src', 'components', 'DeferredToolActivityCard.tsx')))
  assert.doesNotMatch(message, /import\s+\{\s*ToolActivityCard\s*\}\s+from/,
    'tool activity must stay out of the cold conversation graph')
  assert.match(source, /lazy\(\(\)\s*=>\s*import\('\.\/ToolActivityCard\.tsx'\)/,
    'the conditional tool surface owns a dynamic import boundary')
  assert.match(message, /message\.toolActivities && message\.toolActivities\.length > 0[\s\S]*<DeferredToolActivityCard/,
    'ordinary transcript rows do not request the tool UI')
  assert.match(source, /role="status"[\s\S]*data-tool-activity-loading/,
    'a tool transcript retains an announced loading face while its UI arrives')
  assert.match(source, /getDerivedStateFromError[\s\S]*data-tool-activity-load-error[\s\S]*window\.location\.reload\(\)/,
    'a rejected tool chunk retains honest consent copy and an explicit retry')
  assert.doesNotMatch(source, /Nothing was approved/,
    'a display failure cannot claim that historical or already-running activity was never approved')
})

test('escalation consent stays behind an honest local lazy-load recovery face', () => {
  const conversation = stripComments(read(join(ROOT, 'src', 'components', 'ConversationView.tsx')))
  assert.doesNotMatch(conversation, /import\s+\{\s*EscalationPrompt\s*\}\s+from/,
    'the low-frequency consent UI must stay out of the initial conversation chunk')
  assert.match(conversation, /<DeferredEscalationPrompt\b/,
    'pending consent is rendered through the guarded display door')
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredEscalationPrompt.tsx')))
  assert.match(deferred, /lazy\(\(\)\s*=>\s*import\('\.\/EscalationPrompt\.tsx'\)/,
    'the escalation prompt owns one dynamic import boundary')
  assert.match(deferred, /ComponentProps<typeof EscalationPrompt>/,
    'the wrapper reuses the prompt props without redeclaring its contract')
  assert.match(deferred, /getDerivedStateFromError/,
    'a rejected consent chunk remains local to its transcript row')
  assert.match(deferred, /data-escalation-loading[\s\S]*Loading approval…/,
    'the loading face is announced with stable copy and a browser seam')
  assert.match(deferred, /data-escalation-load-error[\s\S]*tone="alert"[\s\S]*Copy any unsent text before reloading/i,
    'the announced failure face warns that reload can discard composer text')
  assert.match(deferred, /window\.location\.reload\(\)/,
    'failed module URLs recover through explicit document reload')
  assert.match(deferred, /Reload to review/,
    'the reload action names its purpose')
  assert.doesNotMatch(deferred, /approval was not applied/i,
    'a display failure cannot claim what happened to the decision elsewhere')
  assert.doesNotMatch(deferred, /onApprove\s*\(/,
    'the failed display never applies the pending approval')
})

test('model preference saving is ready before a picker accepts intent', () => {
  const readDoor = stripComments(read(join(ROOT, 'src', 'api', 'modelPreferences.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'modelPreferences.ts')))

  assert.doesNotMatch(readDoor, /(?:import|export)[^\n]*modelPreferenceCommands/,
    'the initial preference read door must not statically reach write transport')
  assert.match(facade, /import\s+\{[^}]*patchModelPreferences[^}]*\}\s+from\s+'\.\.\/api\/modelPreferenceCommands\.ts'/,
    'saving is available before an accepted preference edit, not behind a failure-cached URL')
  assert.doesNotMatch(facade, /import\(/,
    'resetting a Promise alone cannot recover a browser-cached dynamic-import rejection')
  assert.match(facade, /createRevisionedMutationController/,
    'one ready controller owns held intent and explicit network Retry')
})

test('global search stays behind an announced, dismissible lazy boundary', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredSearchPanel.tsx')))
  assert.doesNotMatch(app, /import\s+\{\s*SearchPanel\s*\}/, 'SearchPanel must stay out of the boot graph')
  assert.match(app, /DeferredSearchPanel/, 'App renders the guarded search door')
  assert.match(deferred, /lazy\(\(\)\s*=>\s*import\('\.\/SearchPanel\.tsx'\)/, 'search owns one dynamic import boundary')
  assert.match(deferred, /data-search-loading/, 'loading has a stable browser seam')
  assert.match(deferred, /role=\{failed \? 'alert' : 'status'\}/, 'failure and loading are announced')
  assert.match(deferred, /getDerivedStateFromError/, 'failure is contained')
  assert.match(deferred, /data-search-load-error/, 'failure has a stable browser seam')
  assert.match(deferred, /window\.location\.reload\(\)/, 'failure offers explicit reload')
  assert.match(deferred, /onClose/, 'loading and failure retain a close door')
  assert.match(deferred, /useFocusTrap\(dialogRef, onClose, \{ initialFocus: closeRef \}\)/,
    'late loading failure cannot arm Enter to reload unsent work')
})

test('artifact form admission includes the complete mutation runtime before editable input', () => {
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredNewArtifactDialog.tsx')))
  assert.match(deferred, /import \{ prepareArtifactCreation \} from '\.\.\/controller\/artifactCreationMutations\.ts'/)
  assert.match(deferred, /lazy\(\(\) => Promise\.all\(\[\s*import\('\.\/NewArtifactDialog\.tsx'\),\s*prepareArtifactCreation\(\),\s*\]\)\.then/,
    'the lazy form waits for both its display and actual save/recovery runtime')
  assert.match(deferred, /window\.location\.reload\(\)/,
    'failed browser module URLs recover by explicit document navigation')
})

test('Contribution review admits its panel and exact mutation runtime behind a local full-reload boundary', () => {
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredContributionReviewPanel.tsx')))
  const mutations = stripComments(read(join(ROOT, 'src/controller/contributionReviewMutations.ts')))
  assert.doesNotMatch(section, /import\s+\{\s*ContributionReviewPanel\s*\}/,
    'the review UI does not inflate the section pane')
  assert.match(section, /<DeferredContributionReviewPanel[\s\S]*lifecycleHeld=\{contributionActionHeld\}/,
    'eager held-state exclusion, including a pending MCP receipt, is retained while the display panel is deferred')
  assert.match(deferred, /lazy\(loadReviewPanel\)/)
  assert.match(deferred, /Promise\.all\(\[[\s\S]*import\('\.\/ContributionReviewPanel\.tsx'\),[\s\S]*prepareContributionReviewRuntime\(\)/,
    'the first review control waits for both its module and exact recovery runtime')
  assert.match(mutations, /prepare:\s*async\s*\(\): Promise<void> => \{ await loadRuntime\(\) \}/,
    'admission loads shared recovery machinery without minting an intent or dispatching')
  assert.match(deferred, /getDerivedStateFromError[\s\S]*data-contribution-review-load="error"/)
  assert.match(deferred, /Copy any unsent text before reloading/)
  assert.match(deferred, /window\.location\.reload\(\)/,
    'a browser-cached rejected module URL recovers through explicit document navigation')
  assert.match(deferred, /data-contribution-review-load="loading"/)
})

test('saved structured editing admits its fields only behind cancelable local loading and failure', () => {
  const page = stripComments(read(join(ROOT, 'src/components/artifactPreview.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredStructuredArtifactEditor.tsx')))
  assert.match(page, /import \{ StructuredArtifactEditor \} from '\.\/DeferredStructuredArtifactEditor'/)
  assert.doesNotMatch(page, /from '\.\/StructuredArtifactEditor'/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/StructuredArtifactEditor\.tsx'\)/)
  assert.match(deferred, /data-structured-editor-load/)
  assert.match(deferred, /getDerivedStateFromError/)
  assert.match(deferred, /disabled=\{saving\} onClick=\{onCancel\}/)
  assert.match(deferred, /Copy any unsaved workspace text before reloading/)
  assert.match(deferred, /window\.location\.reload\(\)/)
})

test('structured artifact bodies load through one shared announced boundary', () => {
  const consumers = [
    'artifactPreview.tsx',
    'RelationActionCard.tsx',
    'StructuredArtifactEditor.tsx',
    'ArtifactSheetImport.tsx',
    'ArtifactPresentationImport.tsx',
  ].map((file) => stripComments(read(join(ROOT, 'src', 'components', file))))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredStructuredArtifactView.tsx')))
  const renderer = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactView.tsx')))

  assert.doesNotMatch(consumers.join('\n'), /import\s+\{\s*StructuredArtifactView\s*\}\s+from\s+['"].\/StructuredArtifactView/u,
    'every saved, consent, editing, and import consumer uses the shared lazy door')
  assert.match(consumers.join('\n'), /DeferredStructuredArtifactView/u,
    'all consumers mount one shared wrapper')
  assert.match(deferred, /lazy\(\(\)\s*=>\s*import\(['"]\.\/StructuredArtifactView\.tsx['"]\)/,
    'the renderer itself is the one deferred module')
  assert.match(deferred, /data-structured-body-loading[\s\S]*Loading artifact content/u,
    'the in-flow pending body is announced and browser-addressable')
  assert.match(deferred, /getDerivedStateFromError[\s\S]*data-structured-body-load-error/u,
    'a rejected renderer chunk is contained at the shared boundary')
  assert.match(deferred, /Couldn’t load artifact content[\s\S]*unsaved workspace text will be lost/u,
    'reload copy names the risk of losing unsaved workspace text')
  assert.match(deferred, /window\.location\.reload\(\)/u,
    'recovery performs an explicit document reload')
  assert.match(deferred, /Reload content/u,
    'the recovery action names its purpose')
  assert.match(deferred, /role="status"[\s\S]*data-structured-body-loading/u,
    'loading is exposed as a polite status')
  assert.match(deferred, /role="alert"[\s\S]*data-structured-body-load-error/u,
    'failure is exposed assertively')
  assert.match(renderer, /export function StructuredArtifactView/u,
    'the original structured renderer remains the rendering authority')
})
