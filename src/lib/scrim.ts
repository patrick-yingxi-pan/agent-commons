/** ── Shared cue: the overlay scrim ────────────────────────────────────────
 *  One styled primitive for every dimmed-backdrop layer (the medium-tier right
 *  panel overlay and the narrow-tier left-rail drawer): same darkness, same
 *  stacking intent, so the "something floats above the thread" cue can't drift
 *  between copies. Callers add their own z-index / click handling.
 *
 *  Form follows function (src/CLAUDE.md): components must use this constant instead
 *  of re-hardcoding the backdrop — locked by src/lib/scrim.test.ts. */
export const SCRIM_CLASS = 'absolute inset-0 bg-black/30'
