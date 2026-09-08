import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadText } from './downloadText.ts'

test('text download uses a disposable Blob and named anchor, with bounded URL cleanup even on failure', (t) => {
  const events: string[] = []
  let blob: Blob | undefined
  let cleanup: (() => void) | undefined
  let shouldThrow = false
  const anchor = {
    href: '', download: '', hidden: false,
    click() { events.push('click'); if (shouldThrow) throw new Error('download refused') },
    remove() { events.push('remove') },
  }
  t.mock.method(URL, 'createObjectURL', (value: Blob) => { blob = value; return 'blob:export' })
  t.mock.method(URL, 'revokeObjectURL', (value: string) => { events.push(`revoke:${value}`) })
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void, delay: number) => {
    assert.equal(delay, 30_000)
    cleanup = callback
    return 1
  }) as typeof setTimeout)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag: string) { assert.equal(tag, 'a'); return anchor },
    body: { append(value: unknown) { assert.equal(value, anchor); events.push('append') } },
  } })
  try {
    const file = { content: '# Saved document\n', filename: 'document.md', mediaType: 'text/markdown;charset=utf-8' as const }
    downloadText(file)
    assert.equal(blob?.type, file.mediaType)
    assert.equal(blob?.size, Buffer.byteLength(file.content))
    assert.equal(anchor.href, 'blob:export')
    assert.equal(anchor.download, 'document.md')
    assert.equal(anchor.hidden, true)
    assert.deepEqual(events, ['append', 'click', 'remove'])
    cleanup!()
    assert.equal(events.at(-1), 'revoke:blob:export')
    shouldThrow = true
    assert.throws(() => downloadText(file), /download refused/)
    assert.equal(events.at(-1), 'remove')
    cleanup!()
    assert.equal(events.at(-1), 'revoke:blob:export')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
