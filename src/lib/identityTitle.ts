/** Native disclosure for a visually truncated identity heading. The data
 * marker lets rendered checks find the exact heading without adding UI chrome. */
export function identityTitleProps(value: string): { title: string; 'data-identity-title': '' } {
  return { title: value, 'data-identity-title': '' }
}
