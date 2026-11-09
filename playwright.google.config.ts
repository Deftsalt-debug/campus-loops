import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Google Maps browser QA. The build carries a placeholder browser key and the
// spec replaces the Maps JavaScript API with a local stub, so no request reaches
// Google and nothing is billed. Real-key checks are a manual release step.
const QA_KEY = 'AIzaFakeKeyForCampusLoopsBrowserQA00000'

export default defineConfig({
  ...base,
  testMatch: 'google-maps.spec.ts',
  testIgnore: [],
  outputDir: 'test-results/google',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/google' }]],
  projects: [{ name: 'google', use: { ...base.use, baseURL: 'http://127.0.0.1:4177/' } }],
  webServer: {
    command: `VITE_GOOGLE_MAPS_API_KEY=${QA_KEY} npx vite build --outDir dist-google --emptyOutDir && npx vite preview --outDir dist-google --host 127.0.0.1 --port 4177 --strictPort`,
    url: 'http://127.0.0.1:4177/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
