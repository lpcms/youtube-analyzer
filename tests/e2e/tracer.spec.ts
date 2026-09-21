import { expect, test, type Page } from "@playwright/test";

/**
 * Сквозной путь: адрес канала → «Начать» → таблица.
 *
 * YouTube подменён локальной заглушкой (tests/e2e/support/mock-youtube.mjs):
 * запросы уходят с сервера Next, из браузера их не перехватить. Заглушка
 * отдаёт 137 видео тремя страницами — канал заведомо больше одной страницы,
 * иначе постраничный обход не проверялся бы вовсе.
 */

/** Столько видео у канала в заглушке. */
const TOTAL = 137;

async function fetchChannel(page: Page, expected = TOTAL): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(expected, { timeout: 60_000 });
}

test.describe("выгрузка канала", () => {
  test("канал больше одной страницы выгружается целиком, без дублей", async ({ page }) => {
    await fetchChannel(page);

    const rows = page.locator("tbody tr");

    // Ни одной повторяющейся ссылки: дублей нет, пропусков тоже.
    const links = await rows
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(links).toHaveLength(TOTAL);
    expect(new Set(links).size).toBe(TOTAL);

    await expect(page.getByRole("columnheader", { name: "URL" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Тип" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Просмотры" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Дата" })).toBeVisible();

    // Дата в формате из ТЗ.
    await expect(rows.first().locator("td").nth(3)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test("в таблице есть строки обоих типов, и тип подтверждён", async ({ page }) => {
    await fetchChannel(page);

    const kinds = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
    expect(kinds.filter((k) => k.trim() === "Video").length).toBeGreaterThan(0);
    expect(kinds.filter((k) => k.trim() === "Shorts").length).toBeGreaterThan(0);
    // Знак вопроса означал бы, что подтвердить тип не удалось.
    expect(kinds.some((k) => k.includes("?"))).toBe(false);
  });

  test("ссылка на видео открывается в новой вкладке", async ({ page, context }) => {
    await fetchChannel(page);

    const link = page.locator("tbody tr").first().getByRole("link");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("href", /^https:\/\/www\.youtube\.com\/watch\?v=/);

    // Проверяем, что клик действительно открывает вторую вкладку, а не
    // уводит текущую: подменяем переход, чтобы не ходить на настоящий YouTube.
    await context.route("https://www.youtube.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>заглушка</h1>" }),
    );

    const [opened] = await Promise.all([context.waitForEvent("page"), link.click()]);
    expect(opened).not.toBe(page);
    expect(page.url()).toContain("127.0.0.1");
  });

  test("обе галочки включены при первой загрузке страницы", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("checkbox", { name: "Video" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Shorts" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Начать" })).toBeEnabled();
  });

  test("запрос 5 видео обоих типов даёт таблицу из 5 строк", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("5");
    await page.getByRole("button", { name: "Начать" }).click();

    await expect(page.locator("tbody tr")).toHaveCount(5, { timeout: 60_000 });
  });

  test("снятая галочка Video оставляет только Shorts", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("6");
    await page.getByRole("checkbox", { name: "Video", exact: true }).uncheck();
    await page.getByRole("button", { name: "Начать" }).click();

    await expect(page.locator("tbody tr")).toHaveCount(6, { timeout: 60_000 });
    const kinds = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
    expect(kinds.every((k) => k.trim() === "Shorts")).toBe(true);
  });

  test("обе галочки сняты — «Начать» недоступна с пояснением", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("checkbox", { name: "Video", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Shorts", exact: true }).uncheck();

    await expect(page.getByRole("button", { name: "Начать" })).toBeDisabled();
    await expect(page.locator("#types-error")).toHaveText(
      "Выберите хотя бы один тип: Video или Shorts",
    );
  });

  test("адрес не с youtube.com отклоняется с сообщением", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Адрес канала").fill("https://vimeo.com/@somebody");
    await page.getByRole("button", { name: "Начать" }).click();

    // Именно наш элемент: role="alert" есть и у служебного объявителя
    // маршрутов Next, поэтому целимся по id, на который смотрит
    // aria-describedby поля.
    const error = page.locator("#channelUrl-error");
    await expect(error).toHaveText("Это не адрес канала YouTube");
    await expect(error).toHaveRole("alert");
    await expect(page.getByLabel("Адрес канала")).toHaveAttribute(
      "aria-describedby",
      "channelUrl-error",
    );
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });
});
