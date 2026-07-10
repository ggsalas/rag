/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/rag/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // We use our own manifest.json in public/
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // ONNX Runtime WASM (~24 MB, used by @huggingface/transformers) is fetched
        // on demand and cached by the browser HTTP cache; too large to precache.
        globIgnores: ['**/ort-wasm-*.wasm'],
        navigateFallback: 'index.html',
        // LLM worker bundle exceeds 2 MiB default; WebLLM model weights are cached separately by the engine.
        // LiteParse WASM is ~4.8 MiB and must fit here for offline PDF parsing.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
