import type { PartnerPublicKey } from '../../contract/taskPartners.ts'

export function parsePartnerKey(text: string): PartnerPublicKey {
  let key: Partial<PartnerPublicKey> & { d?: unknown }
  try {
    key = JSON.parse(text)
  } catch {
    throw new Error('Enter the public signing key as a JSON Web Key (JWK).')
  }
  if (
    !key ||
    typeof key !== 'object' ||
    'd' in key ||
    key.kty !== 'OKP' ||
    key.crv !== 'Ed25519' ||
    typeof key.kid !== 'string' ||
    !key.kid ||
    typeof key.x !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.x)
  )
    throw new Error('Use an Ed25519 public JWK with kid, kty, crv and x. Keep your private key on your server.')
  return { kid: key.kid, kty: key.kty, crv: key.crv, x: key.x }
}
