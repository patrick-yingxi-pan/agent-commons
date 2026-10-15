import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Agent create/edit form loads only on demand and keeps an action-free recoverable shell', () => {
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredAgentDialog.tsx')))
  const form = stripComments(read(join(ROOT, 'src/components/AgentDialog.tsx')))
  const vite = stripComments(read(join(ROOT, 'vite.config.ts')))

  const assertDeferred = (source: string) => {
    assert.match(source, /const Dialog = lazy\(\(\) => import\('\.\/AgentDialog\.tsx'\)/,
      'the implementation is reached only through a dynamic import')
    assert.doesNotMatch(source, /import\s+\{\s*AgentDialog\s*\}\s+from\s+['"]\.\/AgentDialog\.tsx['"]|export \{[^}]*\bAgentDialog\b[^}]*\} from/,
      'the deferred shell has no eager implementation edge')
    assert.match(source, /DeferredLoadBoundary[\s\S]*Suspense[\s\S]*<Dialog \{\.\.\.props\} \/>/,
      'loading and chunk errors stay inside the optional form surface')
    assert.match(source, /data-agent-form-load=\{failed \? 'failed' : 'loading'\}/)
    assert.match(source, /Copy unsent workspace text before reloading/)
    assert.match(source, /onSubmit=\{\(\) => window\.location\.reload\(\)\}/)
  }

  assertDeferred(deferred)
  const eagerMutant = deferred.replace(
    "const Dialog = lazy(() => import('./AgentDialog.tsx').then(module => ({ default: module.AgentDialog })))",
    "import { AgentDialog as Dialog } from './AgentDialog.tsx'",
  )
  assert.notEqual(eagerMutant, deferred)
  assert.throws(() => assertDeferred(eagerMutant), assert.AssertionError,
    'converting the on-demand edge to a static import makes this lock fail')

  assert.match(section, /import \{ DeferredAgentDialog as AgentDialog \} from '\.\/DeferredAgentDialog\.tsx'/)
  assert.equal((section.match(/<AgentDialog\b/g) ?? []).length, 3,
    'new, existing and Agent-page edit entry points all use the same deferred shell')
  assert.doesNotMatch(section, /function AgentDialog\(/)
  assert.match(form, /const original = useRef\(agent\)\.current/)
  assert.match(form, /const outcome = await updateAgent\(agent\.id, fields\)/)
  assert.match(form, /enqueueAgentCreation\(/)

  const assertPromptPolicyChunk = (source: string) => assert.match(source,
    /if \(path\.endsWith\('\/contract\/prompts\.ts'\)\) return 'prompt-policy'/,
    'shared prompt-fit policy stays independent of both SectionPane and the cold boot graph')
  assertPromptPolicyChunk(vite)
  const missingPolicyChunk = vite.replace("if (path.endsWith('/contract/prompts.ts')) return 'prompt-policy'", '')
  assert.notEqual(missingPolicyChunk, vite)
  assert.throws(() => assertPromptPolicyChunk(missingPolicyChunk), assert.AssertionError,
    'removing the prompt policy mapping makes this lock fail')
})
