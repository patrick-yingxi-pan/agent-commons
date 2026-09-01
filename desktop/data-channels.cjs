'use strict'

/** Exact renderer-to-main channels for the native backup capability. */
module.exports = Object.freeze({
  createBackup: 'agent-commons:data:create-backup',
  revealBackups: 'agent-commons:data:reveal-backups',
  restoreBackup: 'agent-commons:data:restore-backup',
})
