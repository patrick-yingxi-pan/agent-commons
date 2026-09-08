import assert from 'node:assert/strict'
import { test } from 'node:test'
import { documentMarkdown } from './artifactExport.ts'

const doc = (blocks: Extract<import('./content.ts').ArtifactContent, { type: 'doc' }>['blocks'], revision?: number) => ({
  type: 'doc' as const,
  title: 'Quarterly plan',
  blocks,
  ...(revision === undefined ? {} : { revision }),
})

test('documentMarkdown preserves ordered document block meaning and literal inline text', () => {
  const result = documentMarkdown('reports/launch.md', doc([
    { h: 'A *literal* <heading>' },
    { p: 'Paragraph with [a link](https://bad.example) and ![an image](x).' },
    { ul: ['first **item**', 'second # item'] },
    { code: ['const fence = ```', 'return "literal"'] },
    { email: { to: 'a@example.test', subject: 'Re: *not formatting*' } },
  ], 4))

  assert.equal(result.filename, 'launch.md')
  assert.equal(result.mediaType, 'text/markdown;charset=utf-8')
  assert.equal(result.revision, 4)
  assert.ok(result.content.includes('# Quarterly plan\n\n## A \\*literal\\* \\<heading\\>\n\n'))
  assert.ok(result.content.includes('Paragraph with \\[a link\\]\\(https\\:\\/\\/bad\\.example\\) and \\!\\[an image\\]\\(x\\)\\.'))
  assert.ok(result.content.includes('- first \\*\\*item\\*\\*'))
  assert.ok(result.content.includes('To: a\\@example\\.test\nSubject: Re\\: \\*not formatting\\*'))
  assert.ok(result.content.includes('````\nconst fence = ```\nreturn "literal"\n````'))
  assert.doesNotMatch(result.content, /\n```\nconst fence/)
})

test('documentMarkdown normalizes line endings and keeps whitespace from becoming Markdown structure', () => {
  const result = documentMarkdown('whitespace.txt', doc([
    { p: '  first\r\n\r\nlast  ' },
    { h: 'next' },
  ], 0))

  assert.equal(result.filename, 'whitespace.md')
  assert.ok(!result.content.includes('\r'))
  assert.ok(result.content.includes('&#32;&#32;first  \n&#10;  \nlast&#32;&#32;'))
  assert.ok(result.content.includes('\n\n## next\n'))
})

test('documentMarkdown encodes whitespace-only lines and multiline titles/headings without new Markdown blocks', () => {
  const result = documentMarkdown('whitespace.md', {
    type: 'doc',
    title: 'Title\nsecond line',
    blocks: [{ h: 'Heading\nsecond heading' }, { p: '  \t ' }],
  })

  assert.ok(result.content.includes('# Title&#10;second line'))
  assert.ok(result.content.includes('## Heading&#10;second heading'))
  assert.ok(result.content.includes('&#32;&#32;&#9;&#32;'))
  assert.doesNotMatch(result.content, /\nsecond line\n/)
  assert.doesNotMatch(result.content, /\nsecond heading\n/)
})

test('documentMarkdown makes portable bounded filenames without bidi, controls, paths, or reserved names', () => {
  const names = [
    ['folder/CON.txt', '_CON.md'],
    ['..\\PRN', '_PRN.md'],
    ['\u202Eevil\u0000name', 'evilname.md'],
  ] as const
  for (const [name, expected] of names) assert.equal(documentMarkdown(name, doc([])).filename, expected)

  const long = documentMarkdown(`${'😀'.repeat(200)}.md`, doc([])).filename
  assert.ok(long.endsWith('.md'))
  assert.ok(Array.from(long.slice(0, -3)).length <= 96)
  assert.ok(new TextEncoder().encode(long).byteLength <= 255)
  assert.ok(!/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(long))
})

test('documentMarkdown uses the body revision and does not invent an artifact id', () => {
  const result = documentMarkdown('notes', doc([{ p: 'body' }], undefined))
  assert.equal(result.revision, 0)
  assert.equal('artifactId' in result, false)
})
