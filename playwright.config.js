const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 300000,
  retries: 1,
  workers: 1,

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  expect: {
    timeout: 10000,
  },

  reporter: [
    ["line"],
    ["html", { open: "never" }],
  ],

  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],

  webServer: {
    command: "SCHEMA_MODEL=haiku npm start",
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
