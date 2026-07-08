/** The loading-spinner motion cue — Tailwind's spin, gated behind `motion-safe`
 *  so it animates ONLY when the viewer hasn't asked their OS to reduce motion
 *  (WCAG 2.3.3; under `prefers-reduced-motion: reduce` the loader shows as a
 *  static icon — kinder to motion-sensitive viewers, and it also lets a headless
 *  screenshot reach a stable frame instead of chasing a never-ending animation).
 *  Kept in lib like SCRIM_CLASS / COPY_BUTTON_CLASS so the shared <Spinner> and
 *  the lock test source it from one place; tests/spinner.test.ts fails if a
 *  component re-hardcodes bare `animate-spin` (which would ignore the setting). */
export const SPINNER_CLASS = 'motion-safe:animate-spin'
