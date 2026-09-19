/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { thirdPartyNotices } from './build-tools/thirdPartyNotices'

// https://vite.dev/config/
// Pure static build. This config lives in web/, so `outDir: 'dist'` writes to
// web/dist on disk. See README → Deployment for the exact Cloudflare Pages
// Root-directory / output-directory pairing (they must be set consistently).
export default defineConfig({
  plugins: [react(), thirdPartyNotices()],
  build: {
    outDir: 'dist',
  },
  test: {
    // M0 tests (citations schema) are pure Node; no DOM needed.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
