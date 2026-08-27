/** One browser message page and one rendered history window (PD36). Kept at
 *  the API boundary so reads and controllers cannot silently choose different
 *  payload budgets. */
export const MESSAGE_PAGE_SIZE = 40
