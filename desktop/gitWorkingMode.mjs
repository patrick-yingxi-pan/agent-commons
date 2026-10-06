/** Extract the regular-file mode from the descriptor helper's stat-version
 * protocol. Git tracks the owner's executable bit, not every permission bit.
 * This compares actual bytes/mode; source configuration is never interpreted. */
export function gitWorkingMode(value) {
  const match = /^(?:[0-9]+:){2}([0-9]+)(?::-?\d+){5}$/.exec(value?.version)
  const mode = Number(match?.[1])
  if (!['file', 'too-large'].includes(value?.status) || !match ||
    !Number.isSafeInteger(mode) || mode < 0 || mode > 0xffff || (mode & 0o170000) !== 0o100000) {
    throw new Error('The Git file metadata is unavailable.')
  }
  return mode & 0o100 ? '100755' : '100644'
}
