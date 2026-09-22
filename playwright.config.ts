import { defineConfig, devices } from "@playwright/test";

/**
 * Свой порт, не 3000.
 *
 * На 3000 живёт дев-сервер, запущенный руками. Playwright с
 * reuseExistingServer подцепился бы к нему — и весь прогон пошёл бы
 * мимо заглушки: с настоящим ключом, в рабочую базу и с настоящей квотой.
 * А подготовка тестов чистит историю каналов, то есть чужие данные.
 * Проверено на себе: один такой прогон стёр выгруженный канал
 * и наделал восьми FAILED-выгрузок в db/dev.db.
 */
const appPort = 3100;
const baseURL = `http://127.0.0.1:${appPort}`;
const mockPort = 3101;

export default defineConfig({
  testDir: "./tests/e2e",
  // support/ — заглушка и подготовка базы, а не тесты.
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Один поток. Тесты делят один дев-сервер и одну базу, а параллельные
  // выгрузки одного канала сталкиваются на upsert одного и того же видео
  // из двух заданий разом. Это ограничение сервиса, а не сортировки:
  // он личный и рассчитан на одну выгрузку за раз. Разводить задания
  // по очереди — задача про кэш и обновление.
  workers: 1,
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
      // Никогда не переиспользуем чужой сервер: занятый порт должен быть
      // громким отказом, а не тихим прогоном не пойми против чего.
      // Заодно снимается старая беда — заглушка, пережившая правку
      // собственного кода, отдаёт прошлые данные.
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        MOCK_YOUTUBE_PORT: String(mockPort),
        // Каждая страница отвечает с задержкой: иначе выгрузка заканчивается
        // раньше, чем тест успевает посмотреть на прогресс.
        MOCK_PAGE_DELAY_MS: "600",
      },
    },
    {
      command: `npm run dev -- --port ${appPort}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        YOUTUBE_API_BASE: `http://127.0.0.1:${mockPort}`,
        // Проверка типа Shorts тоже идёт в заглушку: ни один тест
        // не должен ходить на настоящий youtube.com.
        YOUTUBE_WEB_BASE: `http://127.0.0.1:${mockPort}`,
        YOUTUBE_API_KEY: "e2e-ключ-не-настоящий",
        DATABASE_URL: "file:./db/e2e.db",
        // Своя папка сборки: замок «второй dev-сервер уже запущен» лежит
        // внутри неё, и без этого прогон не встанет рядом с рабочим сервером.
        NEXT_DIST_DIR: ".next-e2e",
        // Снимки прогона — в свою папку: тест проверяет, что сервис переживает
        // её удаление, и сносить ради этого настоящий архив пользователя нельзя.
        HISTORY_DIR: "./db/e2e-history",
      },
    },
  ],
});
