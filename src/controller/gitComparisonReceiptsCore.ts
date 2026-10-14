import type { LocalGitReview } from '../../contract/localGitReview.mjs'
import type { LocalGitReviewComparison } from './localGitReviewsCore.ts'

/** Own byte-free selection identities only for the lifetime of a captured
 * review object. Review content stays outside receipt keys and metadata. */
export function createGitComparisonReceiptsCore() {
  const receiptsByReview = new WeakMap<LocalGitReview, Map<string, number>>()
  let nextReceipt = 1

  const receipt = (
    review: LocalGitReview,
    comparison: LocalGitReviewComparison,
    path: string,
    previousPath?: string,
  ): number => {
    let receipts = receiptsByReview.get(review)
    if (!receipts) {
      receipts = new Map<string, number>()
      receiptsByReview.set(review, receipts)
    }
    // A JSON tuple keeps arbitrary Git paths unambiguous without retaining
    // file contents or relying on a path delimiter that names may contain.
    const selection = JSON.stringify([comparison, path, previousPath ?? null])
    const existing = receipts.get(selection)
    if (existing !== undefined) return existing
    const created = nextReceipt++
    receipts.set(selection, created)
    return created
  }

  return { receipt }
}
