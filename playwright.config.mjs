import {defineConfig, devices} from "@playwright/test";

const port = Number(process.env.JS_BROWSER_FIXTURE_PORT || 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid loopback fixture port");
const baseURL = "http://127.0.0.1:" + port;

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
  use: {baseURL, browserName: "chromium", channel: process.env.JS_BROWSER_CHANNEL || undefined, serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure"},
  projects: [
    {name: "desktop", use: {viewport: {width: 1280, height: 800}}},
    {name: "mobile", use: {...devices["Pixel 7"], viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, defaultBrowserType: "chromium"}}
  ],
  webServer: {command: "node tests/browser/fixture-server.mjs", url: baseURL + "/__fixture/health", reuseExistingServer: false, timeout: 30000}
});
