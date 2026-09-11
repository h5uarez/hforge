import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://localhost:4173'
const visualUse = {
  browserName: 'chromium',
  colorScheme: 'dark',
  locale: 'en-US',
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
      threshold: 0.15,
    },
  },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}-{projectName}{ext}',
  use: {
    baseURL,
    colorScheme: 'dark',
    locale: 'en-US',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/test-stack.mjs',
    url: 'http://127.0.0.1:4173/img/0025-EIeI8Vf.jpg',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'media-proxy-chromium', testMatch: /media-proxy\.spec\.js/, use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' } },
    { name: 'visual-chromium-320', testMatch: /visual\.spec\.js/, use: { ...visualUse, viewport: { width: 320, height: 568 } } },
    { name: 'visual-chromium-375', testMatch: /visual\.spec\.js/, use: { ...visualUse, viewport: { width: 375, height: 667 } } },
    { name: 'visual-chromium-414', testMatch: /visual\.spec\.js/, use: { ...visualUse, viewport: { width: 414, height: 896 } } },
    { name: 'visual-chromium-desktop', testMatch: /visual\.spec\.js/, use: { ...visualUse, viewport: { width: 1440, height: 1000 } } },
    { name: 'functional-chromium', testMatch: /functional\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' } },
    { name: 'functional-firefox', testMatch: /functional\.spec\.js/, use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' } },
    { name: 'functional-webkit', testMatch: /functional\.spec\.js/, use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' } },
    { name: 'webauthn-chromium', testMatch: /webauthn\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' } },
  ],
})
