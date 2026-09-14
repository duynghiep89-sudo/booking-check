import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { trackingApiPlugin } from './server/trackPlugin.ts'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/booking-check/' : '/',
  plugins: [react(), trackingApiPlugin()],
  optimizeDeps: {
    exclude: ['playwright'],
  },
  ssr: {
    external: ['playwright'],
  },
  server: {
    port: 5176,
    strictPort: false,
    watch: {
      ignored: ['**/.browser-profile/**'],
    },
  },
})
