import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a running stack (pnpm dev or docker compose).
 * BASE_URL defaults to http://localhost:3000.
 * Tests tagged @ai call the real AI provider and run only when E2E_AI=1.
 */
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]],
  outputDir: "../../test-results",
  grepInvert: process.env.E2E_AI === "1" ? undefined : /@ai/,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
