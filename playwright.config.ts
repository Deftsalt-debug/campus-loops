import { defineConfig, devices } from '@playwright/test'

const externalBase = process.env.BROWSER_BASE_URL
const proxy = process.env.HTTPS_PROXY

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // A second complete pass is explicit in CI; failures must not disappear in retries.
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    timezoneId: 'Asia/Kolkata',
    reducedMotion: 'reduce',
    // Only for cloud workspaces whose outbound inspection proxy uses a private CA.
    ignoreHTTPSErrors: process.env.BROWSER_IGNORE_HTTPS_ERRORS === '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.BROWSER_EXECUTABLE_PATH,
      args: ['--enable-unsafe-swiftshader'],
      ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
    },
  },
  projects: externalBase
    ? [{ name: 'published', use: { baseURL: externalBase } }]
    : [
        { name: 'root', use: { baseURL: 'http://127.0.0.1:4175/' } },
        { name: 'github-pages', use: { baseURL: 'http://127.0.0.1:4176/campus-loops/' } },
      ],
  webServer: externalBase ? undefined : [
    { command: 'npm run preview -- --host 127.0.0.1 --port 4175 --strictPort', url: 'http://127.0.0.1:4175/', reuseExistingServer: !process.env.CI },
    { command: 'npm run preview -- --host 127.0.0.1 --port 4176 --strictPort --base /campus-loops/', url: 'http://127.0.0.1:4176/campus-loops/', reuseExistingServer: !process.env.CI },
  ],
})
