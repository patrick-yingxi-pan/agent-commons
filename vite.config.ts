import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Minimal ambient `process` so the config can read env-driven ports without
// pulling in @types/node (the UI tsconfig ships no Node types by design).
declare const process: { env: Record<string, string | undefined> }

// `base` is set to a relative path so the production build works both on
// GitHub Pages (project subpath) and when opened from a static host.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
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
    },
  },
})
