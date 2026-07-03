/** ── Stream-resumption policy (pure) ───────────────────────────────────────
 *  The client half of the resumable ambient stream (multi-account design §5.3,
 *  invariant I3 — no silent loss). Framework-free and import-free so `node
 *  --test` can lock the rule directly (src/api/events.ts, which applies it,
 *  transitively needs Vite's import.meta.env and can't load under node). */

/** Whether a `hello` demands a full cache reset:
 *  - first-ever hello (`priorEpoch` null): nothing streamed before — no reset;
 *  - epoch changed: the server restarted and reseeded — reset;
 *  - same epoch but `resumed` is not true: a REconnection whose missed events
 *    were NOT replayed (the gap aged out of the server's ring buffer, or the
 *    server predates the event log) — reset, so staleness can't survive a gap.
 *  `resumed: true` means the server replayed the gap: the cache is continuous. */
export function helloRequiresReset(e: { epoch: string; resumed?: boolean }, priorEpoch: string | null): boolean {
  if (priorEpoch === null) return false
  return priorEpoch !== e.epoch || e.resumed !== true
}
