import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Архив снимков в history/.
 *
 * Два обещания, и второе важнее первого: файл после выгрузки появляется,
 * но сервис от него не зависит — с удалённой папкой всё читается из SQLite
 * ровно так же.
 *
 * Папка берётся из HISTORY_DIR, который прогону задаёт playwright.config.ts:
 * тест её удаляет, а настоящий архив пользователя сносить нельзя.
 */

const HISTORY = path.resolve(process.env.HISTORY_DIR ?? "./db/e2e-history");

const CHANNEL = "https://www.youtube.com/@e2e-gen1";
const CHANNEL_TITLE = "Меняющийся канал";
const ROWS = 10;

const history = (page: Page) => page.locator("#channel-history");

async function fetchChannel(page: Page): Promise<void> {
  await page.getByLabel("Адрес канала").fill(CHANNEL);
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(ROWS, { timeout: 60_000 });
}

/** Убирает канал из истории, если он там есть: тесты делят одну базу. */
async function clearHistory(page: Page): Promise<void> {
  await page.goto("/");
  for (let guard = 0; guard < 10; guard += 1) {
    const remove = history(page).getByRole("button", { name: "Удалить" }).first();
    if ((await remove.count()) === 0) break;
    await remove.click();
    await history(page).getByRole("button", { name: "Да, удалить" }).click();
    await expect(history(page).getByRole("button", { name: "Да, удалить" })).toHaveCount(0);
  }
}

async function snapshots(): Promise<string[]> {
  return (await readdir(HISTORY).catch(() => [])).filter((name) => name.endsWith(".xlsx"));
}

/** Ждёт файл: снимок пишется уже после того, как таблица показана. */
async function waitForSnapshot(): Promise<string[]> {
  await expect.poll(async () => (await snapshots()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  return snapshots();
}

test.describe("снимок выгрузки на диске", () => {
  test("после выгрузки в папке появляется книга, и папка заводится сама", async ({ page }) => {
    await rm(HISTORY, { recursive: true, force: true });
    await clearHistory(page);

    await fetchChannel(page);

    const files = await waitForSnapshot();
    expect(files).toHaveLength(1);
    // Имя несёт канал и время: по файлу видно, чей это снимок и когда снят.
    expect(files[0]).toContain(CHANNEL_TITLE);
    expect(files[0]).toMatch(/UC[\w-]+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.xlsx$/);
  });

  test("удалённая папка не ломает сервис: канал из истории открывается", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);
    await waitForSnapshot();

    // Архив сносится целиком — вместе с папкой, а не только с файлами.
    await rm(HISTORY, { recursive: true, force: true });

    await page.goto("/");
    await history(page).getByRole("link", { name: CHANNEL_TITLE }).click();

    // Таблица читается из SQLite, и удалённого архива ей не нужно.
    await expect(page.locator("tbody tr")).toHaveCount(ROWS, { timeout: 30_000 });
    await expect(page.getByRole("columnheader")).toHaveCount(9);
    await expect(page.getByRole("link", { name: "Скачать таблицу" }).first()).toBeVisible();
  });

  test("повторная выгрузка не затирает прежний снимок", async ({ page }) => {
    await rm(HISTORY, { recursive: true, force: true });
    await mkdir(HISTORY, { recursive: true });
    await clearHistory(page);

    await fetchChannel(page);
    await waitForSnapshot();

    await page.goto("/");
    await fetchChannel(page);

    await expect.poll(async () => (await snapshots()).length, { timeout: 15_000 }).toBe(2);
  });
});
