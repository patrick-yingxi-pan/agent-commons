/** Persisted decisions describe history. Graph state is only a legacy fallback
 * for a card without a recorded verdict; a held decision waits for its receipt. */
export function relationConsentVerdict(
  recorded: 'confirmed' | 'skipped' | undefined,
  held: boolean,
  applied: boolean,
): 'confirmed' | 'skipped' | 'pending' {
  if (held) return 'pending'
  return recorded ?? (applied ? 'confirmed' : 'pending')
}
