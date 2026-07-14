import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-audio",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run audio:lab",
    url: "http://127.0.0.1:4174/audio-lab.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
