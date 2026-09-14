import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  reporter: [["list"], ["html", {outputFolder: "outputs/browser-report", open: "never"}]],
  outputDir: "outputs/browser-results",
  use: {baseURL: "http://127.0.0.1:4179", browserName: "chromium", serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure"},
  projects: [
    {name: "desktop", use: {viewport: {width: 1280, height: 800}}},
    {name: "mobile", use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}}
  ],
  webServer: {command: "node tests/browser/fixture-server.mjs", url: "http://127.0.0.1:4179/__fixture/health", reuseExistingServer: false, timeout: 30000}
});
