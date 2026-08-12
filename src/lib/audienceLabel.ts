/** What a grant's AUDIENCE is called on screen.
 *
 *  One line of code with two readers, which is exactly when it needs a home: the
 *  grants roster renders it per row, and the Sharing section's folded stub
 *  renders the same names as its index entry. Written twice they drift, and the
 *  drift is invisible — both look like "the audience", and the stub is read
 *  precisely when the roster is not on screen to be compared with.
 *
 *  `Audience` is a discriminated union, so this is total by construction rather
 *  than by a default branch: adding a fourth kind is a compile error here
 *  instead of a row that silently renders nothing. */
import type { Audience } from '../../contract/social.ts'

export function audienceLabel(a: Audience): string {
  switch (a.kind) {
    case 'org':
      return a.orgId
    case 'principal':
      return a.principalId
    case 'link':
      return 'anyone with the link'
  }
}
