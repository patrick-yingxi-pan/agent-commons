import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` is set to a relative path so the production build works both on
// GitHub Pages (project subpath) and when opened from a static host.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // Bind to IPv4 loopback explicitly — on this host "localhost" resolves to
  // ::1 only, which the preview/browser (hitting 127.0.0.1) can't reach.
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Same-origin API: the UI calls `/api/v1/*`; in dev Vite forwards that to the
    // standalone mock backend. In production the server serves both, so the UI's
    // URLs are identical in every environment — that's what keeps it portable.
    proxy: {
      // The mock backend's default port (override with PORT when running it).
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
