import { expect, test, type Page } from "@playwright/test";

/**
 * Сравнение двух выгрузок канала.
 *
 * Меняющийся канал заглушки для этого и заведён: между gen1 и gen2 просмотры
 * растут, два ролика пропадают, один появляется. Всё сравнение читается
 * из SQLite — ни одного обращения к YouTube за прошлыми цифрами, которых
 * у API и нет.
 */

const GEN1 = "https://www.youtube.com/@e2e-gen1";
const GEN2 = "https://www.youtube.com/@e2e-gen2";
const CHANNEL_TITLE = "Меняющийся канал";
const BEFORE = 10;
const AFTER = 9;

const compare = (page: Page) => page.locator("#compare");

async function fetchChannel(page: Page, url: string, expectedRows: number): Promise<void> {
  await page.getByLabel("Адрес канала").fill(url);
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(expectedRows, { timeout: 60_000 });
}

/** Убирает канал из истории, если он там есть: тесты делят одну базу. */
async function clearHistory(page: Page): Promise<void> {
  await page.goto("/");
  const history = page.locator("#channel-history");
  for (let guard = 0; guard < 10; guard += 1) {
    const remove = history.getByRole("button", { name: "Удалить" }).first();
    if ((await remove.count()) === 0) break;
    await remove.click();
    await history.getByRole("button", { name: "Да, удалить" }).click();
    await expect(history.getByRole("button", { name: "Да, удалить" })).toHaveCount(0);
  }
}

/** Строка сравнения по названию ролика. */
const rowFor = (page: Page, title: string) =>
  compare(page).locator("tbody tr").filter({ hasText: title });

test.describe("сравнение выгрузок", () => {
  test("канал с единственной выгрузкой объясняет, что сравнивать не с чем", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page, GEN1, BEFORE);

    await expect(compare(page)).toContainText("Сравнивать пока не с чем");
    // Ни выбора дат, ни кнопки: предлагать нечего.
    await expect(compare(page).getByRole("combobox")).toHaveCount(0);
  });

  test("у канала с двумя выгрузками видны прирост числом и долей", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page, GEN1, BEFORE);
    await fetchChannel(page, GEN2, AFTER);

    // Умолчание — две последние выгрузки, выбирать заново не нужно.
    await expect(compare(page).getByLabel("Ранняя выгрузка")).toBeVisible();
    await compare(page).getByRole("button", { name: "Сравнить" }).click();

    await expect(compare(page).locator("tbody tr")).toHaveCount(BEFORE + 1, { timeout: 30_000 });

    // Просмотры удвоились: и число, и доля от прежнего значения.
    const survivor = rowFor(page, "Меняющееся видео 0");
    await expect(survivor).toContainText("+500");
    await expect(survivor).toContainText("+100,0 %");

    // Комментарии не менялись — честный ноль, а не пустая ячейка.
    await expect(survivor).toContainText("0,0 %");
  });

  test("появившееся помечено новым, исчезнувшее не пропадает из сравнения", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page, GEN1, BEFORE);
    await fetchChannel(page, GEN2, AFTER);

    await compare(page).getByRole("button", { name: "Сравнить" }).click();
    await expect(compare(page).locator("tbody tr")).toHaveCount(BEFORE + 1, { timeout: 30_000 });

    // Ролик c10 появился только в gen2.
    await expect(rowFor(page, "Меняющееся видео 10")).toContainText("новое");
    // Ролики c8 и c9 пропали, но остались в сравнении с пометкой.
    await expect(rowFor(page, "Меняющееся видео 8")).toContainText("исчезло");
    await expect(rowFor(page, "Меняющееся видео 9")).toContainText("исчезло");

    // У них прочерк, а не прирост от нуля.
    await expect(rowFor(page, "Меняющееся видео 10")).toContainText("—");

    await expect(compare(page).locator("#compare-summary")).toContainText(
      "сравнено: 8 · новых: 1 · исчезло: 2",
    );
  });

  test("канал из истории сравнивается без новой выгрузки", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page, GEN1, BEFORE);
    await fetchChannel(page, GEN2, AFTER);

    // Канал открывается из истории — «Начать» не нажимается ни разу,
    // а сравнение всё равно собирается: оба снимка уже в SQLite.
    await page.goto("/");
    await page.locator("#channel-history").getByRole("link", { name: CHANNEL_TITLE }).click();
    await expect(page.locator("tbody tr")).toHaveCount(AFTER, { timeout: 30_000 });

    await compare(page).getByRole("button", { name: "Сравнить" }).click();
    await expect(compare(page).locator("tbody tr")).toHaveCount(BEFORE + 1, { timeout: 30_000 });
    await expect(rowFor(page, "Меняющееся видео 0")).toContainText("+500");

    // Что при этом не уходит ни одного запроса к API, проверяет
    // интеграционный тест: запросы идут с сервера, и из браузера их не видно.
  });

  test("неполная выгрузка названа неполной и в списке, и над таблицей", async ({ page }) => {
    await clearHistory(page);
    await fetchChannel(page, GEN1, BEFORE);

    // Просим три ролика: остальные не запрашивали, а не потеряли.
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("3");
    await fetchChannel(page, GEN1, 3);

    await expect(compare(page).getByLabel("Поздняя выгрузка")).toContainText("неполная");

    await compare(page).getByRole("button", { name: "Сравнить" }).click();
    await expect(compare(page).locator("tbody tr")).toHaveCount(BEFORE, { timeout: 30_000 });

    await expect(compare(page)).toContainText("обошла канал не целиком");
  });
});
