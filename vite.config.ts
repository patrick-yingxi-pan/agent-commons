import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { bundleBudgetPlugin } from './scripts/bundleBudget.ts'
import { thirdPartyNoticesPlugin } from './scripts/thirdPartyNotices.ts'

// Minimal ambient `process` so the config can read env-driven ports without
// pulling in @types/node (the UI tsconfig ships no Node types by design).
declare const process: { env: Record<string, string | undefined> }

// The production deploy is a same-origin server with canonical root URLs. Its
// SPA fallback serves this one index.html at nested paths such as
// `/projects/p-insights`, so assets must stay rooted at `/assets/...`: a
// relative `./assets/...` would resolve to `/projects/assets/...` on refresh
// and leave every deep link blank. A static project-subpath host is not this
// app's deploy shape — it could not serve the same-origin API in any case.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), bundleBudgetPlugin(), thirdPartyNoticesPlugin()],
  // The HTML crawl does not follow ?worker entries. Scan those graphs too:
  // discovering their packages on first use can change common dependency
  // chunks and reload the page, aborting an in-flight document selection.
  // This affects development pre-bundling only; production stays lazy.
  optimizeDeps: { entries: ['index.html', 'src/**/*.worker.ts'] },
  build: {
    rollupOptions: {
      output: {
        // Keep shared primitives in their own explicit chunk. Otherwise Rollup
        // folds FormDialog back into SectionPane, making its lazy form import
        // the entire navigation module through that shared-shell back edge.
        onlyExplicitManualChunks: true,
        /** Stable framework chunks improve cross-release caching and keep one
         * physical file from monopolising parse/evaluation. The bundle-budget
         * plugin still sums these into the cold graph, so this cannot hide boot
         * cost behind cosmetic chunk names. */
        manualChunks(id) {
          const path = id.split('\\').join('/')
          if (path.endsWith('/src/components/FormDialog.tsx')) return 'resource-form'
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(path)) return 'vendor-react'
          if (/\/node_modules\/(?:framer-motion|motion-dom|motion-utils)\//.test(path)) return 'vendor-motion'
        },
      },
    },
  },
  // Bind to IPv4 loopback explicitly — on this host "localhost" resolves to
  // ::1 only, which the preview/browser (hitting 127.0.0.1) can't reach.
  server: {
    host: '127.0.0.1',
    // Default 5173, but honor PORT so a second instance (another worktree, a
    // preview runner assigning a free port) can coexist with the first.
    port: Number(process.env.PORT) || 5173,
    // Same-origin API: the UI calls `/api/v1/*`; in dev Vite forwards that to the
    // standalone mock backend. In production the server serves both, so the UI's
    // URLs are identical in every environment — that's what keeps it portable.
    proxy: {
      // The mock backend's default port (MOCK_PORT shifts it in lockstep with
      // scripts/dev.mjs, so the proxy follows the backend across instances).
      '/api': { target: `http://127.0.0.1:${process.env.MOCK_PORT || 8787}`, changeOrigin: true },
      // The A2A well-known Agent Card (D20) lives at the server root by protocol
      // convention — forward it so the dev origin serves it like the deploy shape.
      '/.well-known': { target: `http://127.0.0.1:${process.env.MOCK_PORT || 8787}`, changeOrigin: true },
    },
  },
})
