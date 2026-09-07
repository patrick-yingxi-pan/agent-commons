import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeLocalTextPreview, isLocalTextFileName, LOCAL_TEXT_PREVIEW_BYTES } from './localTextFile.mjs'

const bytes = (text: string) => new TextEncoder().encode(text)

test('recognizes source, configuration, and extensionless text filenames case-insensitively', () => {
  for (const name of [
    'README', 'LICENSE', 'Makefile', 'Dockerfile', '.gitignore', '.env.example',
    'main.py', 'app.ts', 'view.tsx', 'index.js', 'component.jsx', 'loader.mjs',
    'config.cjs', 'lib.rs', 'server.go', 'Main.java', 'native.c', 'header.cpp',
    'run.sh', 'query.sql', 'settings.toml', 'settings.ini', 'service.conf',
  ]) assert.equal(isLocalTextFileName(name), true, name)

  for (const name of ['report.pdf', 'word.docx', 'archive.zip', 'data.bin', 'photo.png', 'photo.jpg', 'image.gif', 'image.webp', 'drawing.svg', '']) {
    assert.equal(isLocalTextFileName(name), false, name)
  }
  assert.equal(isLocalTextFileName('src/README'), false)
  assert.equal(isLocalTextFileName('src\\README'), false)
  assert.equal(isLocalTextFileName(null as unknown as string), false)
})

test('decodes whole valid UTF-8 and preserves empty text, Unicode, CRLF, and BOM literally', () => {
  assert.equal(decodeLocalTextPreview(bytes('')), '')
  const text = '\uFEFFhéllo\r\n世界\n'
  assert.equal(decodeLocalTextPreview(bytes(text)), text)
})

test('rejects invalid UTF-8 and UTF-16 binary bytes instead of replacement-decoding them', () => {
  assert.equal(decodeLocalTextPreview(new Uint8Array([0xc3, 0x28])), undefined)
  assert.equal(decodeLocalTextPreview(new Uint8Array([0xff, 0xfe, 0x41, 0x00])), undefined)
})

test('rejects NUL, DEL, and disallowed C0 controls but allows tab, LF, CR, and FF', () => {
  for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8, 0x0b, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x7f]) {
    assert.equal(decodeLocalTextPreview(bytes(`ok${String.fromCharCode(code)}text`)), undefined, `U+${code.toString(16).padStart(4, '0')}`)
  }
  const allowed = 'tab\tline\ncarriage\rfeed\fend'
  assert.equal(decodeLocalTextPreview(bytes(allowed)), allowed)
})

test('accepts exactly 256 KiB and rejects larger payloads without truncating', () => {
  const exact = 'a'.repeat(LOCAL_TEXT_PREVIEW_BYTES)
  assert.equal(decodeLocalTextPreview(bytes(exact)), exact)
  assert.equal(decodeLocalTextPreview(bytes(`${exact}b`)), undefined)
})

test('enforces the byte limit for multibyte UTF-8 rather than string length', () => {
  const exact = 'é'.repeat(LOCAL_TEXT_PREVIEW_BYTES / 2)
  assert.equal(bytes(exact).byteLength, LOCAL_TEXT_PREVIEW_BYTES)
  assert.equal(decodeLocalTextPreview(bytes(exact)), exact)
  assert.equal(decodeLocalTextPreview(bytes(`${exact}é`)), undefined)
})
