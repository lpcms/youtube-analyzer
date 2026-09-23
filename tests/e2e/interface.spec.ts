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

    // И после галочки Shorts, а не где-то выше по странице.
    //
    // Проверяется порядок в разметке, а не координаты: строка управления
    // переносится на узком экране, и на 1280 плашка уезжает под галочки.
    // Это нормально — «после Shorts» про порядок, а не про пиксели.
    const order = await page.evaluate(() => {
      const shorts = document.querySelector('input[name="includeShorts"]');
      const plate = document.querySelector("#service-status");
      if (shorts === null || plate === null) return null;
      // DOCUMENT_POSITION_FOLLOWING: плашка идёт после галочки.
      return (shorts.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });

    expect(order).toBe(true);
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

test.describe("компактность формы", () => {
  test("подпись поля ушла в плейсхолдер, но осталась для скринридера", async ({ page }) => {
    await page.goto("/");

    const field = page.getByLabel("Адрес канала");
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("placeholder", /^Адрес канала: /);

    // На экране подписи нет — она только для скринридера.
    await expect(page.locator("label[for='channelUrl']")).toHaveClass(/sr-only/);
  });

  test("поиск, «Начать» и настройки стоят одной строкой", async ({ page }) => {
    await page.goto("/");

    const field = await page.getByLabel("Адрес канала").boundingBox();
    const count = await page.getByLabel("Количество").boundingBox();

    // Раньше поле занимало отдельную строку сверху: теперь они на одной,
    // и до таблицы не надо прокручивать лишний экран.
    expect(Math.abs((field?.y ?? 0) - (count?.y ?? 0))).toBeLessThan(40);
  });

  test("волчок крутится во время выгрузки и уходит по её окончании", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();

    const spinner = page.locator("#fetch-progress svg");
    await expect(spinner).toBeVisible();
    // Кнопка недоступна ровно пока волчок крутится.
    await expect(page.getByRole("button", { name: "Выгружаю…" })).toBeDisabled();

    await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE, { timeout: 60_000 });

    await expect(spinner).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Начать" })).toBeEnabled();
    // Счёт назван с единицей: «Готово: 137» читалось бы как что угодно.
    await expect(page.locator("#fetch-progress")).toHaveText("Готово: 137 видео");
  });

  test("расход квоты назван с единицей измерения", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#quota-spent")).toHaveText(/из\s*10 000 единиц/);
  });
});

test.describe("шапка таблицы", () => {
  test("сведения о канале слева, листание справа, одной строкой", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE, { timeout: 60_000 });

    const note = await page.locator("#snapshot-note").boundingBox();
    const pager = await page.locator("[data-place='top']").boundingBox();

    expect(note).not.toBeNull();
    expect(pager).not.toBeNull();
    // Одна строка: раньше это были две.
    expect(Math.abs((note?.y ?? 0) - (pager?.y ?? 0))).toBeLessThan(40);
    // Листание правее сведений о канале.
    expect(pager?.x ?? 0).toBeGreaterThan(note?.x ?? 0);
  });
});
