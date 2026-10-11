import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setData } from './cache.ts'
import { useFsSources, useFsCatalog } from './fsHooks.ts'
import { keys } from './keys.ts'
import { readFileSync } from 'node:fs'

test('optional filesystem query code stays outside eager API entries', () => {
  for (const file of ['hooks.ts', 'index.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /from ['"][^'"]*fs(?:Hooks|Reads)(?:\.ts)?['"]/, file)
    assert.doesNotMatch(source, /function useFs(?:Query|Sources|Catalog|Folder|Text)\b/, file)
  }
})

test('filesystem pickers cannot render cached success before mount revalidation starts', () => {
  const source = { id: 'cloud', kind: 'cloud' as const, label: 'Cloud storage' }
  setData(keys.fsSources, [source])
  setData(keys.fsCatalog(source.id), { source, files: [], photos: [], folders: [] })
  for (const useRead of [useFsSources, () => useFsCatalog(source.id)]) {
    function FirstRender() { return createElement('output', null, useRead().status) }
    assert.equal(renderToStaticMarkup(createElement(FirstRender)), '<output>loading</output>')
  }
})

test('disabled filesystem reads retain the query cache state without claiming pending admission', () => {
  function DisabledRead() { return createElement('output', null, useFsCatalog('disabled-source', false).status) }
  assert.equal(renderToStaticMarkup(createElement(DisabledRead)), '<output>idle</output>')
})
