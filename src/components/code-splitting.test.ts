/** Section pages are a real on-demand feature boundary: a conversation boot
 * must not eagerly evaluate the 14k-line all-sections surface. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('expanded Contexts rail rows load registry and native metadata behind local recovery', () => {
  const tree = stripComments(read(join(ROOT, 'src/components/SectionTreeChildren.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredContextChildren.tsx')))
  const boundary = stripComments(read(join(ROOT, 'src/components/DeferredRailChildren.tsx')))
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
  assert.doesNotMatch(section, /import\s+\{[^}]*McpConnection(?:CreateDialog|Detail)[^}]*\}\s+from\s+['"]\.\/McpConnectionPanel/,
    'the large MCP panel is absent from the SectionPane graph')
  assert.match(section, /DeferredMcpConnectionCreateDialog/)
  assert.match(section, /DeferredMcpConnectionDetail/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/McpConnectionPanel\.tsx'\)/,
    'both low-frequency MCP bodies share the module’s deferred chunk')
  assert.match(deferred, /CreateFallback[\s\S]*useFocusTrap\(dialogRef, onClose, \{ initialFocus: cancelRef \}\)[\s\S]*useBoundedDialog\(dialogRef\)[\s\S]*BOUNDED_DIALOG_LAYER_CLASS[\s\S]*Reload app[\s\S]*Cancel/,
    'create loading/error uses the shared bounded modal grammar and keeps Cancel/reload')
  assert.match(deferred, /DetailFallback[\s\S]*<AtomicResourcePage[\s\S]*<BackButton to=\{backTo\} onBack=\{onBack\} \/>[\s\S]*Reload details/,
    'detail loading/error preserves canonical page back navigation and explicit reload')
  assert.match(deferred, /getDerivedStateFromError[\s\S]*Suspense/,
    'module failures stay inside the named MCP recovery shells')
})

test('context browsing loads only after explicit Browse with local cancel and warned reload', () => {
  const picker = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredContextBrowseDialog.tsx')))
  assert.match(picker, /DeferredContextBrowseDialog as BrowseDialog/)
  assert.doesNotMatch(picker, /from ['"]\.\/ContextBrowseDialog/)
  assert.equal((picker.match(/browsing && \(\s*<BrowseDialog/g) ?? []).length, 2,
    'both repository and connector/MCP browsing stay behind explicit intent')
  assert.equal((picker.match(/return \(\s*<>\s*\{browsing && \(\s*<BrowseDialog/g) ?? []).length, 2,
    'optional browsing recovery precedes both potentially tall recent lists')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ContextBrowseDialog\.tsx'\)/)
  assert.match(deferred, /ComponentProps<typeof ContextBrowseDialog>/)
  assert.match(deferred, /data-context-browse-loading[\s\S]*tone="status"/)
  assert.match(deferred, /getDerivedStateFromError[\s\S]*data-context-browse-load-error[\s\S]*tone="alert"/)
  assert.match(deferred, /Copy any unsent text before reloading/)
  assert.match(deferred, /label: 'Cancel browsing', onClick: this\.props\.onCancel/)
  assert.match(deferred, /label: 'Reload app', onClick: \(\) => window\.location\.reload\(\)/)
  assert.doesNotMatch(deferred, /onConfirm\(/, 'loading and failure cannot attach a candidate')
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
