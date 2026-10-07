import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDelimitedText } from './delimitedText.ts'

test('TSV preserves quoted tabs, doubled quotes, and embedded row breaks', () => {
  assert.deepEqual(parseDelimitedText('name\tnote\tvalue\r\nAda\t"tab\tinside and ""quoted""\r\nsecond line"\t42', '\t'), [
    ['name', 'note', 'value'],
    ['Ada', 'tab\tinside and "quoted"\r\nsecond line', '42'],
  ])
})

test('trailing delimiters preserve empty cells and blank records while one final row terminator is optional', () => {
  assert.deepEqual(parseDelimitedText('a\tb\t\r\n\r\nlast\t', '\t'), [
    ['a', 'b', ''],
    [''],
    ['last', ''],
  ])
  assert.deepEqual(parseDelimitedText('a,b,\n', ','), [['a', 'b', '']])
  assert.deepEqual(parseDelimitedText('a,b,', ','), [['a', 'b', '']])
  assert.deepEqual(parseDelimitedText('\n', ','), [['']])
  assert.equal(parseDelimitedText('', ','), undefined)
})

test('CSV retains its existing quoting and separator behavior', () => {
  assert.deepEqual(parseDelimitedText('  spaced  ,"line 1\rline 2, with ""quotes"""\rGrace,,formula\n', ','), [
    ['  spaced  ', 'line 1\rline 2, with "quotes"'],
    ['Grace', '', 'formula'],
  ])
})

test('malformed quote placements and unterminated quoted cells are rejected', () => {
  for (const source of ['"unterminated', 'prefix"quote', '"closed"suffix', '"closed" space', 'a,"b"x,c']) {
    assert.equal(parseDelimitedText(source, ','), undefined, source)
  }
  assert.equal(parseDelimitedText('"a"x\tb', '\t'), undefined)
})
