import "@testing-library/jest-dom/vitest";
import path from "node:path";

/**
 * Снимки выгрузок в прогоне идут в свою папку.
 *
 * Интеграционные тесты гоняют выгрузку целиком, а она кладёт `.xlsx`
 * в `history/`. Настоящий архив пользователя — не свалка для файлов прогона,
 * и удалять его ради чистоты тестов тем более нельзя.
 */
process.env.HISTORY_DIR ??= path.join(process.cwd(), "db", "test-history");

/**
 * jsdom не реализует ResizeObserver, хотя он есть во всех браузерах.
 * Заглушка нужна таблице: она следит за своей шириной, чтобы верхняя
 * полоса прокрутки совпадала с нижней.
 */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
