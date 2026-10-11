export type ClosedRecordKeyMode = 'enumerable' | 'all'

/** Check exact own keys using enumerable string keys by default, or all own keys. */
export function isClosedRecord(
  value: unknown,
  fields: readonly string[],
  mode?: ClosedRecordKeyMode,
): boolean
