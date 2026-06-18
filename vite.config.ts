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
  },
})
