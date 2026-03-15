const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  reporter: [["line"]],
  webServer: {
    command: "npm start",
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
