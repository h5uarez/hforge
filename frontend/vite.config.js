import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true },
      '/video': { target: media, changeOrigin: true }
    }
  },
  // Pinned explicit defaults: sourcemap off and the rolldown/oxc minifier this
  // Vite major resolves by default (merged.minify === true -> 'oxc'), so the
  // emitted output is identical with or without these keys. NOTE: minify is
  // deliberately NOT 'esbuild' here — that value selects the deprecated
  // transformWithEsbuild path, which requires the esbuild package (absent from
  // this install) and fails the build; 'oxc' is this toolchain's default.
  build: { chunkSizeWarningLimit: 1500, sourcemap: false, minify: 'oxc' },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.test.{js,jsx}',
        'src/exercises-data.js',
        'src/lib/exercises-data.js',
        'src/lib/body-paths.js',
        'src/locales/**',
        'src/instr/**'
      ],
      thresholds: {
        statements: 39,
        branches: 35,
        functions: 27,
        lines: 43
      }
    }
  }
})
