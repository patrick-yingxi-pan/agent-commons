/** Full code comparisons distinguish exact text (including empty) from a
 * non-content explanation, without implying that unknown text was deleted. */
export type TextDiffSide = { label: string; text: string; notice?: never } | { label: string; text?: never; notice: string }
