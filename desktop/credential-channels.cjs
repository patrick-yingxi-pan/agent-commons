'use strict'

/** One tiny CommonJS module because the sandboxed preload is CommonJS while the
 * main process is ESM. Keeping channel names here prevents a typo from silently
 * turning the credential bridge into two different protocols. */
module.exports = Object.freeze({
  provision: 'agent-commons:credentials:provision',
  bind: 'agent-commons:credentials:bind',
  discard: 'agent-commons:credentials:discard',
  removeProvider: 'agent-commons:credentials:remove-provider',
})
