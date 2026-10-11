export const MAX_OUTBOUND_URL_LENGTH: number

export class OutboundAddressError extends Error {
  readonly code: 'invalid_outbound_endpoint'
  constructor()
}

export function isPublicAddress(address: string): boolean
export function parseOutboundEndpoint(raw: string, scope: 'public' | 'loopback'): URL
