import { expect, test, type Page } from "@playwright/test";

/**
 * Разбивка таблицы на страницы.
 *
 * Канал в заглушке — 137 видео, поэтому по полсотни на странице выходит три
 * страницы с неполной последней.
 */

const TOTAL = 137;
const PAGE_SIZE = 50;

async function fetchChannel(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE, { timeout: 60_000 });
}

/**
 * Панель листания стоит дважды — над таблицей и под ней. Тесты работают
 * с верхней, поэтому селекторы названы явно: без места они ловили бы
 * обе панели разом.
 */
const TOP_NAV = "Страницы таблицы, сверху";

function forward(page: Page) {
  return page.getByRole("navigation", { name: TOP_NAV }).getByRole("button", { name: /Вперёд/ });
}

function rowCount(page: Page) {
  return page.locator("#row-count-top");
}

function pageSizeSelect(page: Page) {
  return page.locator("#pageSize-top");
}

/** Ссылки видимой страницы — по ним видно, сменился ли набор строк. */
async function visibleLinks(page: Page): Promise<Array<string | null>> {
  return page
    .locator("tbody tr")
    .getByRole("link")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
}

test.describe("страницы таблицы", () => {
  test("показывается страница, а не вся выгрузка", async ({ page }) => {
    await fetchChannel(page);

    await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE);
    // Общее число строк и номер страницы видны рядом с таблицей.
    await expect(rowCount(page)).toHaveText(new RegExp(String(TOTAL)));
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(
      /Страница\s*1\s*из\s*3/,
    );
  });

  test("вторая страница показывает другие строки", async ({ page }) => {
    await fetchChannel(page);
    const first = await visibleLinks(page);

    await forward(page).click();
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(
      /Страница\s*2\s*из\s*3/,
    );
    // Номер страницы меняется сразу, а строки приходят с сервера позже:
    // без этого ожидания тест читал бы ещё первую страницу.
    await expect
      .poll(async () => (await visibleLinks(page))[0], { timeout: 15_000 })
      .not.toBe(first[0]);

    const second = await visibleLinks(page);
    expect(second).toHaveLength(PAGE_SIZE);
    // Ни одной общей строки: страницы не перекрываются.
    expect(second.filter((href) => first.includes(href))).toEqual([]);
  });

  test("последняя страница неполная", async ({ page }) => {
    await fetchChannel(page);

    await forward(page).click();
    await forward(page).click();

    await expect(page.locator("tbody tr")).toHaveCount(TOTAL - 2 * PAGE_SIZE);
    await expect(rowCount(page)).toHaveText(/101–137/);
    await expect(forward(page)).toBeDisabled();
  });

  test("переключение страницы сохраняет сортировку", async ({ page }) => {
    await fetchChannel(page);

    await page.getByRole("button", { name: /Просмотры/ }).click();
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    const firstPage = await visibleLinks(page);

    await forward(page).click();
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(/Страница\s*2/);

    // Ждём сами строки, а не номер страницы: и номер, и подпись «51–100»
    // панель меняет сразу по клику, не дожидаясь ответа сервера, и тест
    // успевал прочитать ещё первую страницу.
    await expect.poll(async () => (await visibleLinks(page))[0]).not.toBe(firstPage[0]);

    // Порядок не сбросился на «свежие сверху».
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    const views = (await page.locator("tbody tr td:nth-child(4)").allInnerTexts()).map((t) =>
      Number(t.replace(/\s/g, "")),
    );
    expect(views).toEqual([...views].sort((a, b) => b - a));
    // Вторая страница продолжает первую, а не начинает заново с максимума.
    expect(views[0]).toBeLessThan(1000 * TOTAL);
  });

  test("смена размера страницы меняет разбивку", async ({ page }) => {
    await fetchChannel(page);

    await pageSizeSelect(page).selectOption("25");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(/из\s*6/);

    await pageSizeSelect(page).selectOption("100");
    await expect(page.locator("tbody tr")).toHaveCount(100);
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(/из\s*2/);
  });

  test("смена размера не отбрасывает в начало таблицы", async ({ page }) => {
    await fetchChannel(page);

    await pageSizeSelect(page).selectOption("100");
    await forward(page).click();
    await expect(rowCount(page)).toHaveText(/101–137/);

    // Были видны строки со 101-й; по двадцать пять это пятая страница.
    await pageSizeSelect(page).selectOption("25");
    await expect(rowCount(page)).toHaveText(/101–125/);
  });

  test("переключение доступно с клавиатуры", async ({ page }) => {
    await fetchChannel(page);

    await forward(page).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(/Страница\s*2/);
  });

  test("выгрузка на одну страницу не показывает переключатель", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("8");
    await page.getByRole("button", { name: "Начать" }).click();

    await expect(page.locator("tbody tr")).toHaveCount(8, { timeout: 60_000 });
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveCount(0);
    // Выбор размера тоже ни к чему, пока строк меньше самого мелкого.
    await expect(pageSizeSelect(page)).toHaveCount(0);
    // Но число строк всё равно сообщается.
    await expect(rowCount(page)).toHaveText(/1–8/);
  });
});

test.describe("прокрутка таблицы", () => {
  test("полоса прокрутки есть и сверху, и снизу, и они синхронны", async ({ page }) => {
    await fetchChannel(page);

    const top = page.locator("table").locator("xpath=../..").locator("> div").first();
    const bottom = page.locator("table").locator("xpath=..");

    // Верхняя полоса шириной с таблицу, иначе прокручивать было бы нечего.
    const spacerWidth = await top.locator("div").evaluate((el) => el.getBoundingClientRect().width);
    const tableWidth = await page.locator("table").evaluate((el) => el.scrollWidth);
    expect(Math.round(spacerWidth)).toBe(Math.round(tableWidth));

    // Прокрутка верхней полосы двигает таблицу.
    await top.evaluate((el) => {
      el.scrollLeft = 200;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(async () => bottom.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    // И наоборот.
    await bottom.evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(async () => top.evaluate((el) => el.scrollLeft)).toBe(0);
  });
});

test.describe("панель над таблицей и под ней", () => {
  const BOTTOM_NAV = "Страницы таблицы, снизу";

  test("обе панели показывают одно и то же", async ({ page }) => {
    await fetchChannel(page);

    await expect(rowCount(page)).toHaveText(/1–50/);
    await expect(page.locator("#row-count-bottom")).toHaveText(/1–50/);

    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(
      /Страница\s*1\s*из\s*3/,
    );
    await expect(page.getByRole("navigation", { name: BOTTOM_NAV })).toHaveText(
      /Страница\s*1\s*из\s*3/,
    );
  });

  test("нижняя панель листает так же, как верхняя", async ({ page }) => {
    await fetchChannel(page);
    const first = await visibleLinks(page);

    await page
      .getByRole("navigation", { name: BOTTOM_NAV })
      .getByRole("button", { name: /Вперёд/ })
      .click();

    // Верхняя панель узнаёт о переходе: состояние у них общее.
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(/Страница\s*2/);
    await expect
      .poll(async () => (await visibleLinks(page))[0], { timeout: 15_000 })
      .not.toBe(first[0]);
    await expect(rowCount(page)).toHaveText(/51–100/);
    await expect(page.locator("#row-count-bottom")).toHaveText(/51–100/);
  });

  test("размер страницы, выбранный внизу, виден наверху", async ({ page }) => {
    await fetchChannel(page);

    await page.locator("#pageSize-bottom").selectOption("25");

    await expect(page.locator("tbody tr")).toHaveCount(25);
    await expect(pageSizeSelect(page)).toHaveValue("25");
    await expect(page.getByRole("navigation", { name: TOP_NAV })).toHaveText(/из\s*6/);
  });

  test("скачать таблицу можно и сверху, и снизу", async ({ page }) => {
    await fetchChannel(page);

    const links = page.getByRole("link", { name: "Скачать таблицу" });
    await expect(links).toHaveCount(2);

    // Обе ведут в одно место — иначе снизу скачивался бы другой файл.
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs[0]).toBe(hrefs[1]);
  });

  test("панель сверху стоит раньше таблицы, снизу — позже", async ({ page }) => {
    await fetchChannel(page);

    const order = await page.evaluate(() => {
      const top = document.querySelector("#row-count-top");
      const bottom = document.querySelector("#row-count-bottom");
      const table = document.querySelector("table");
      if (top === null || bottom === null || table === null) return null;

      // DOCUMENT_POSITION_FOLLOWING = 4: узел идёт после сравниваемого.
      return {
        topBeforeTable: (top.compareDocumentPosition(table) & 4) !== 0,
        tableBeforeBottom: (table.compareDocumentPosition(bottom) & 4) !== 0,
      };
    });

    expect(order).toEqual({ topBeforeTable: true, tableBeforeBottom: true });
  });
});
