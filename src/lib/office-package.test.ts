import assert from 'node:assert/strict'
import { test } from 'node:test'
import { xlsxFixture } from '../../tests/helpers/xlsxFixture.mjs'
import { OfficeExtractionError, packagePartName, readOfficePackage } from './officePackage.ts'
import { workbookRelationships } from './xlsxText.ts'

const limits = { maxEntries: 32, maxPartBytes: 1024, maxExpandedBytes: 4096 }

test('package URI escapes are canonicalized once and preserve literal ZIP names', async () => {
  const archive = await readOfficePackage(xlsxFixture({ entries: {
    'xl/space name.xml': 'space entry',
    'xl/percent%20name.xml': 'percent entry',
  } }), limits)
  try {
    assert.equal(await archive.readPart(packagePartName('xl/space%20name.xml')), 'space entry')
    assert.equal(await archive.readPart(packagePartName('xl/percent%2520name.xml')), 'percent entry')
  } finally {
    await archive.close()
  }
})

test('a double-escaped target never aliases a differently named space entry', async () => {
  const archive = await readOfficePackage(xlsxFixture({ entries: { 'xl/foo .xml': 'wrong entry' } }), limits)
  try {
    await assert.rejects(
      () => archive.readPart(packagePartName('xl/foo%2520.xml')),
      (error: unknown) => error instanceof OfficeExtractionError && error.status === 'invalid',
    )
  } finally {
    await archive.close()
  }
})

test('closed and missing package parts fail without exposing archive data', async () => {
  const archive = await readOfficePackage(xlsxFixture({ entries: { 'xl/value.xml': 'value' } }), limits)
  await assert.rejects(() => archive.readPart('xl/missing.xml'), (error: unknown) => error instanceof OfficeExtractionError && error.status === 'invalid')
  await archive.close()
  await assert.rejects(() => archive.readPart('xl/value.xml'), (error: unknown) => error instanceof OfficeExtractionError && error.status === 'invalid')
})

test('relationship targets resolve once against percent-containing canonical bases', () => {
  const xml = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="urn:worksheet" Target="worksheets/sheet%2520one.xml"/>' +
    '</Relationships>'
  const relations = workbookRelationships(xml, 'xl/percent%20dir/workbook.xml')
  assert.equal(relations.get('rId1')?.target, 'xl/percent%20dir/worksheets/sheet%20one.xml')
})
