/** Check exact record keys while preserving the contract's chosen key view. */
export function isClosedRecord(value, fields, mode = 'enumerable') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value
  const keys = mode === 'enumerable' ? Object.keys(item) : Reflect.ownKeys(item)
  return keys.length === fields.length && fields.every((key) => Object.hasOwn(item, key)) &&
    (mode === 'enumerable' || keys.every((key) => typeof key === 'string' && fields.includes(key)))
}
