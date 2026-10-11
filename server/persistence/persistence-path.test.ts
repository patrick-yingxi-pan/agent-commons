import assert from 'node:assert/strict'
import { relative, resolve } from 'node:path'
import { test } from 'node:test'
import { databaseFile, dataFile } from './format.ts'

test('node test processes require explicit persistence paths but accept temp and memory paths', () => {
  const previous = {
    data: process.env.DATA_FILE,
    database: process.env.DATABASE_PATH,
    testContext: process.env.NODE_TEST_CONTEXT,
  }
  try {
    assert.ok(previous.testContext, 'node --test must set its process marker')
    delete process.env.DATA_FILE
    delete process.env.DATABASE_PATH
    assert.throws(() => dataFile(), /DATA_FILE must be set explicitly/)
    assert.throws(() => databaseFile(), /DATABASE_PATH must be set explicitly/)

    process.env.DATA_FILE = '/tmp/agent-commons-persistence-fixture.json'
    process.env.DATABASE_PATH = ':memory:'
    assert.equal(dataFile(), '/tmp/agent-commons-persistence-fixture.json')
    assert.equal(databaseFile(), ':memory:')

    const liveJson = resolve('.data/store.json')
    const liveSqlite = resolve('.data/store.db')
    process.env.DATA_FILE = liveJson
    assert.throws(() => dataFile(), /cannot target the live default path/)
    process.env.DATA_FILE = relative(process.cwd(), liveJson)
    assert.throws(() => dataFile(), /cannot target the live default path/, 'relative equivalents are blocked too')
    process.env.DATABASE_PATH = liveSqlite
    assert.throws(() => databaseFile(), /cannot target the live default path/)
    process.env.DATA_FILE = '/tmp/agent-commons-distinct-fixture.json'
    process.env.DATABASE_PATH = ':memory:'
    assert.equal(dataFile(), '/tmp/agent-commons-distinct-fixture.json')
    assert.equal(databaseFile(), ':memory:')
  } finally {
    if (previous.data === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = previous.data
    if (previous.database === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.database
    if (previous.testContext === undefined) delete process.env.NODE_TEST_CONTEXT
    else process.env.NODE_TEST_CONTEXT = previous.testContext
  }
})
