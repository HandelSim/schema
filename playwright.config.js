const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 180000,         // 3 minutes per test (decomposition is slow)
  retries: 1,              // Retry once on failure (AI decomposition is non-deterministic)
  workers: 1,              // Serial — tests share server state

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    actionTimeout: 15000,   // 15s for clicks, fills, etc.
    navigationTimeout: 30000,
  },

  expect: {
    timeout: 10000,         // 10s for assertions
  },

  reporter: [
    ["line"],
    ["html", { open: "never" }],
  ],

  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],

  webServer: {
    command: "npm start",
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
