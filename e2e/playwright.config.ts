import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  outputDir: ".results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: "light",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node serve.mjs",
    url: "http://127.0.0.1:4173",
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
