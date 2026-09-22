import { expect, test, type Page } from "@playwright/test";

/**
 * История каналов.
 *
 * Сквозной путь: выгрузить канал, вернуться на главную, найти его в списке,
 * открыть и получить ту же таблицу — без единого обращения к YouTube.
 */

const CHANNEL = "https://www.youtube.com/@e2e-gen1";
const CHANNEL_TITLE = "Меняющийся канал";
const ROWS = 10;

const history = (page: Page) => page.locator("#channel-history");
const channelLink = (page: Page) => history(page).getByRole("link", { name: CHANNEL_TITLE });

async function fetchChannel(page: Page, url = CHANNEL, rows = ROWS): Promise<void> {
  await page.getByLabel("Адрес канала").fill(url);
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(rows, { timeout: 60_000 });
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

test.describe("список каналов", () => {
  test("пустая история объясняет, а не показывает пустой список", async ({ page }) => {
    await clearHistory(page);

    await expect(history(page)).toContainText("Выгрузок ещё не было");
    await expect(history(page).getByRole("listitem")).toHaveCount(0);
  });

  test("после выгрузки канал появляется со счётчиками и датой", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);

    // Список собирается на сервере, поэтому обновляется сам, без перезагрузки.
    await expect(channelLink(page)).toBeVisible();

    const row = history(page).getByRole("listitem").first();
    // Десять роликов заглушки — все обычные видео.
    await expect(row).toContainText(`${ROWS} Video · 0 Shorts`);
    await expect(row).toContainText(/выгружено \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });
});

test.describe("открытие канала из истории", () => {
  test("даёт ту же таблицу с сортировкой, страницами и выгрузкой", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);

    // Уходим со страницы выгрузки и возвращаемся через список.
    await page.goto("/");
    await expect(page.locator("tbody tr")).toHaveCount(0);

    await channelLink(page).click();
    await expect(page.locator("tbody tr")).toHaveCount(ROWS, { timeout: 30_000 });

    // Колонки, сортировка, страницы и выгрузка — те же самые.
    await expect(page.getByRole("columnheader")).toHaveCount(9);
    await page.getByRole("button", { name: /Просмотры/ }).click();
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(page.locator("#row-count-top")).toHaveText(new RegExp(`из\\s*${ROWS}`));
    await expect(page.getByRole("link", { name: "Скачать таблицу" }).first()).toBeVisible();
  });

  test("над таблицей видно, когда данные собраны", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);

    await page.goto("/");
    await channelLink(page).click();
    await expect(page.locator("tbody tr")).toHaveCount(ROWS, { timeout: 30_000 });

    const note = page.locator("#snapshot-note");
    await expect(note).toContainText(CHANNEL_TITLE);
    await expect(note).toContainText(/данные собраны \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  test("открытие из истории не идёт в YouTube", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);

    // Заглушка YouTube живёт на отдельном порту — по нему обращения и видно.
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("127.0.0.1:3101")) apiCalls.push(request.url());
    });

    await page.goto("/");
    await channelLink(page).click();
    await expect(page.locator("tbody tr")).toHaveCount(ROWS, { timeout: 30_000 });

    expect(apiCalls).toEqual([]);
  });
});

test.describe("удаление канала", () => {
  test("спрашивает подтверждение и называет канал", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);
    await page.goto("/");

    await history(page).getByRole("button", { name: "Удалить" }).first().click();

    // Вопрос называет канал: в списке из пяти строк «Удалить?» без имени —
    // это приглашение ошибиться.
    await expect(history(page)).toContainText(`Удалить «${CHANNEL_TITLE}»`);
    await expect(history(page).getByRole("button", { name: "Да, удалить" })).toBeVisible();

    // Канал ещё на месте: один клик ничего не удалил.
    await expect(channelLink(page)).toBeVisible();
  });

  test("отмена оставляет канал на месте", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);
    await page.goto("/");

    await history(page).getByRole("button", { name: "Удалить" }).first().click();
    await history(page).getByRole("button", { name: "Отмена" }).click();

    await expect(history(page).getByRole("button", { name: "Да, удалить" })).toHaveCount(0);
    await expect(channelLink(page)).toBeVisible();
  });

  test("подтверждение убирает канал из списка", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);
    await page.goto("/");

    await history(page).getByRole("button", { name: "Удалить" }).first().click();
    await history(page).getByRole("button", { name: "Да, удалить" }).click();

    await expect(channelLink(page)).toHaveCount(0);
    await expect(history(page)).toContainText("Выгрузок ещё не было");
  });
});

test.describe("обновление истории не мешает таблице", () => {
  const BIG = "https://www.youtube.com/@e2e";
  const BIG_TITLE = "Канал для E2E";

  test("удаление соседнего канала не трогает открытую таблицу", async ({ page }) => {
    await clearHistory(page);

    // Два канала: маленький пойдёт под удаление, большой останется открытым.
    await fetchChannel(page);
    await page.goto("/");
    await fetchChannel(page, BIG, 50);

    // Настраиваем таблицу так, чтобы сброс на умолчания был заметен.
    await page.locator("#pageSize-top").selectOption("25");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByRole("button", { name: /Просмотры/ }).click();
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    // Удаляем именно соседний канал.
    const neighbour = history(page).getByRole("listitem").filter({ hasText: CHANNEL_TITLE });
    await neighbour.getByRole("button", { name: "Удалить" }).click();
    await neighbour.getByRole("button", { name: "Да, удалить" }).click();
    await expect(channelLink(page)).toHaveCount(0);

    // Таблица на месте и с теми же настройками: пересборка истории
    // не должна перемонтировать форму.
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(page.locator("#row-count-top")).toHaveText(/из\s*137/);
    await expect(history(page).getByRole("link", { name: BIG_TITLE })).toBeVisible();
  });

  test("удаление открытого канала уводит со страницы его выгрузки", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page);

    const row = history(page).getByRole("listitem").filter({ hasText: CHANNEL_TITLE });
    await row.getByRole("button", { name: "Удалить" }).click();
    await row.getByRole("button", { name: "Да, удалить" }).click();

    // Таблицы удалённого канала на экране остаться не должно.
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });
});
