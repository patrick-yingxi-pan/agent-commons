/** Typed backend facade over the native-importable outbound-address policy.
 * Re-exported bindings preserve one implementation and class identity. */
export {
  MAX_OUTBOUND_URL_LENGTH,
  OutboundAddressError,
  isPublicAddress,
  parseOutboundEndpoint,
} from './outboundAddressCore.mjs'
