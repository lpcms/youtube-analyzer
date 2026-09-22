import { expect, test, type Page } from "@playwright/test";

/**
 * Оформление страницы: знак сервиса, место строки состояния и копирование
 * из первой колонки таблицы.
 *
 * Всё это видно только в настоящем браузере: порядок элементов в вёрстке,
 * значок во вкладке и буфер обмена в jsdom не проверить.
 */

const PAGE_SIZE = 50;

async function fetchChannel(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE, { timeout: 60_000 });
}

test.describe("знак сервиса", () => {
  test("вкладка получает значок, и он лёгкий", async ({ page }) => {
    await page.goto("/");

    const href = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(href).not.toBeNull();

    const response = await page.request.get(href ?? "");
    expect(response.ok()).toBe(true);
    expect((await response.body()).byteLength).toBeLessThan(2048);
  });

  test("в шапке страницы знак стоит рядом с заголовком", async ({ page }) => {
    await page.goto("/");

    const heading = page.getByRole("heading", { name: "Анализатор YouTube-каналов" });
    await expect(heading).toBeVisible();
    // Знак декоративный: заголовок рядом говорит то же словами.
    await expect(page.locator("main svg[aria-hidden='true']").first()).toBeVisible();
  });
});

test.describe("строка состояния сервиса", () => {
  test("стоит в форме, сразу после галочки Shorts", async ({ page }) => {
    await page.goto("/");

    const status = page.locator("#service-status");
    await expect(status).toBeVisible();

    // Внутри формы, а не отдельной полосой над ней.
    await expect(page.locator("form #service-status")).toHaveCount(1);

    // И правее галочки Shorts, а не где-то выше по странице.
    const shorts = await page.getByRole("checkbox", { name: "Shorts" }).boundingBox();
    const box = await status.boundingBox();
    expect(shorts).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box?.x ?? 0).toBeGreaterThan(shorts?.x ?? 0);
    // На одной строке: разница по вертикали меньше высоты самой строки.
    expect(Math.abs((box?.y ?? 0) - (shorts?.y ?? 0))).toBeLessThan(40);
  });
});

test.describe("копирование из первой колонки", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("кнопка кладёт в буфер ссылку на видео", async ({ page }) => {
    await fetchChannel(page);

    const first = page.locator("tbody tr").first();
    const href = await first.getByRole("link").first().getAttribute("href");

    await first.getByRole("button", { name: "Скопировать ссылку на видео" }).click();

    await expect(first.getByRole("button", { name: "Скопировано" }).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(href);
  });

  test("кнопка кладёт в буфер название видео целиком", async ({ page }) => {
    await fetchChannel(page);

    const first = page.locator("tbody tr").first();
    // В ячейке название обрезано по ширине, полное лежит в title.
    const title = await first.locator("span[title]").getAttribute("title");

    await first.getByRole("button", { name: "Скопировать название видео" }).click();

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(title);
  });
});

test.describe("вид таблицы", () => {
  test("числа выровнены по центру и отделены чертой", async ({ page }) => {
    await fetchChannel(page);

    const views = page.locator("tbody tr").first().getByRole("cell").nth(2);

    await expect(views).toHaveCSS("text-align", "center");
    // Черта между ячейками есть и она светлая, а не жирная рамка.
    const width = await views.evaluate((el) => getComputedStyle(el).borderRightWidth);
    expect(parseFloat(width)).toBeGreaterThan(0);
    expect(parseFloat(width)).toBeLessThanOrEqual(2);
  });
});
