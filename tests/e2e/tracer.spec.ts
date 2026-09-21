import { expect, test } from "@playwright/test";

/**
 * Сквозной путь: адрес канала → «Начать» → таблица.
 *
 * YouTube подменён локальной заглушкой (tests/e2e/support/mock-youtube.mjs):
 * запрос уходит с сервера Next, из браузера его не перехватить.
 */
test.describe("трассирующая пуля", () => {
  test("ввод адреса даёт таблицу из 10 строк", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(10);

    // Колонки трассирующей пули.
    await expect(page.getByRole("columnheader", { name: "URL" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Просмотры" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Дата" })).toBeVisible();

    // Дата в формате из ТЗ.
    await expect(rows.first().locator("td").nth(2)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test("ссылка на видео открывается в новой вкладке", async ({ page, context }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(10);

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
