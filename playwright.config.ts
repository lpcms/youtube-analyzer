import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";
const mockPort = 3101;

export default defineConfig({
  testDir: "./tests/e2e",
  // support/ — заглушка и подготовка базы, а не тесты.
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // html-отчёт не открывает браузер сам: прогон должен оставаться неинтерактивным.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Заглушка YouTube: запрос к API уходит с сервера Next, из браузера
      // его не перехватить, поэтому сервер на время прогона смотрит сюда.
      command: "node tests/e2e/support/mock-youtube.mjs",
      url: `http://127.0.0.1:${mockPort}/channels`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_YOUTUBE_PORT: String(mockPort) },
    },
    {
      command: "npm run dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        YOUTUBE_API_BASE: `http://127.0.0.1:${mockPort}`,
        YOUTUBE_API_KEY: "e2e-ключ-не-настоящий",
        DATABASE_URL: "file:./db/e2e.db",
      },
    },
  ],
});
