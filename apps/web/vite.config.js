import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  server: { port: 5173 },
  // Lazy-loaded libs: pre-bundle up front so the dev server never re-optimises mid-session
  // (that would load two copies of Vue and break rendering).
  optimizeDeps: { include: ['elkjs/lib/elk.bundled.js', 'html-to-image', 'jszip', 'sql.js', 'y-partyserver/provider'] },
  build: { chunkSizeWarningLimit: 1500 },
})
