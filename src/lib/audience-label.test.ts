/** The one audience label (`src/lib/audienceLabel.ts`) — and the scan that keeps
 *  it the only one, which is the whole reason a one-line function has a module. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import { audienceLabel } from './audienceLabel.ts'

test('every audience kind gets a name, and none of them is empty', () => {
  assert.equal(audienceLabel({ kind: 'org', orgId: 'tenant-beta' }), 'tenant-beta')
  assert.equal(audienceLabel({ kind: 'principal', principalId: 'ada' }), 'ada')
  // A link grant has no id worth showing — the token IS the secret, so it names
  // the reach instead. Asserted because "show the id" is the obvious wrong fix.
  assert.equal(audienceLabel({ kind: 'link', token: 'sh_secret_value' }), 'anyone with the link')
  assert.doesNotMatch(audienceLabel({ kind: 'link', token: 'sh_secret_value' }), /sh_secret/, 'the token never renders')
})

test('nothing re-hardcodes the label — the roster and the folded stub read one function', () => {
  // The drift this forbids is invisible by construction: both spellings look
  // like "the audience", and the folded Sharing stub is read exactly when the
  // roster it must agree with is off screen. So the rule is scanned, not
  // trusted — the same shape as the tier-pill and text-door locks.
  const offenders: string[] = []
  for (const file of filesUnder('src')) {
    if (file.endsWith('lib/audienceLabel.ts')) continue
    const src = stripComments(read(file))
    // Reaching into the union's payload is the tell. Two narrowings, both
    // deliberate: `GrantsPanel`'s own FORM legitimately CONSTRUCTS an audience
    // (`{ kind: 'org', orgId: … }`), so a bare mention of a field is not the
    // offence — reading one off a value is. And `.token` is excluded, because
    // `audienceLabel` never returns it: a link grant is named by its reach, so a
    // token read is always for something else (the copy-link button builds a
    // `/shared/:token` URL from it) and can never be a second spelling of this
    // label. A scan that flagged it would be teaching people to add allowlist
    // entries, which is where real duplicates would then hide.
    if (/\.audience\.(orgId|principalId)\b/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `these render an audience without the shared label: ${offenders.join(', ')}`)
  // Vacuity guard: the scan must have had the real subject in front of it.
  const panel = read('src/components/GrantsPanel.tsx')
  assert.match(panel, /audienceLabel\(/, 'the roster routes through the shared label')
})
