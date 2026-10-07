import { test } from 'node:test'
import assert from 'node:assert/strict'
import { literalSearchSnippet } from './literalSearch.ts'

test('literal snippets preserve original case and bound long text around the first match', () => {
  const content = `${'prefix '.repeat(100)}First NEEDLE here${' suffix'.repeat(100)}`
  const snippet = literalSearchSnippet(content, 'needle')
  assert.ok(snippet)
  assert.ok(snippet.includes('NEEDLE'))
  assert.ok(snippet.length <= 320)
  assert.equal(snippet.startsWith('…'), true)
  assert.equal(snippet.endsWith('…'), true)
  assert.equal(literalSearchSnippet('x'.repeat(500) + 'TaRget', 'target', 32)?.endsWith('TaRget'), true)
})

test('a match near the end stays in the bounded source-position snippet', () => {
  const content = `${'a'.repeat(600)}Needle${'b'.repeat(600)}`
  const snippet = literalSearchSnippet(content, 'needle')
  assert.ok(snippet)
  assert.ok(snippet.includes('Needle'))
  assert.ok(snippet.startsWith('…'))
  assert.ok(snippet.endsWith('…'))
  assert.ok(snippet.length <= 320)
})

test('full-string lowercase matching retains Unicode context and expanded source offsets', () => {
  assert.equal(literalSearchSnippet('ΟΣ', 'ος'), 'ΟΣ', 'Greek final sigma uses whole-string lowercase semantics')
  assert.equal(literalSearchSnippet('İ and more text', 'i\u0307'), 'İ and more text', 'expanded lowercase match maps to its source character')

  const content = `${'İ'.repeat(100)}${'a'.repeat(100)}needle${'b'.repeat(500)}`
  const snippet = literalSearchSnippet(content, 'needle')
  assert.ok(snippet)
  assert.ok(snippet.includes('needle'))
  assert.ok(snippet.length <= 320)
})

test('empty and absent queries return undefined; query syntax stays literal', () => {
  assert.equal(literalSearchSnippet('anything', ''), undefined)
  assert.equal(literalSearchSnippet('nothing here', 'missing'), undefined)
  assert.equal(literalSearchSnippet('needlex', 'needl.'), undefined)
})

test('custom bounds are respected, including tiny limits', () => {
  const content = `${'x'.repeat(40)}MATCH${'y'.repeat(40)}`
  for (const maxChars of [0, 1, 2, 3, 8, 31, 320]) {
    const snippet = literalSearchSnippet(content, 'match', maxChars)
    assert.ok(snippet !== undefined)
    assert.ok(snippet.length <= maxChars, `snippet <= ${maxChars}`)
  }
  assert.equal(literalSearchSnippet('short MATCH text', 'match', 100), 'short MATCH text')
})

test('snippet extraction does not mutate the source string', () => {
  const content = `before ${'İ'.repeat(100)}needle after`
  const original = content
  literalSearchSnippet(content, 'needle', 20)
  assert.equal(content, original)
})
