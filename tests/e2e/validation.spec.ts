import { expect, test, type Page } from "@playwright/test";

/**
 * Валидация формы.
 *
 * Проверяется и то, что сообщение показано, и то, что оно программно связано
 * со своим полем: без этого скринридер прочитает поле, не назвав причину отказа.
 */

async function expectFieldError(page: Page, label: string, errorId: string, text: string | RegExp) {
  const field = page.getByLabel(label);
  await expect(field).toHaveAttribute("aria-describedby", errorId);
  await expect(field).toHaveAttribute("aria-invalid", "true");

  const message = page.locator("#" + errorId);
  await expect(message).toHaveText(text);
  await expect(message).toHaveRole("alert");
}

test.describe("валидация формы", () => {
  test("пустой адрес даёт сообщение под полем", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Начать" }).click();

    await expectFieldError(page, "Адрес канала", "channelUrl-error", "Введите адрес канала");
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });

  test("чужой домен даёт сообщение и не запускает выгрузку", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://vimeo.com/@somebody");
    await page.getByRole("button", { name: "Начать" }).click();

    await expectFieldError(page, "Адрес канала", "channelUrl-error", "Это не адрес канала YouTube");
    // Выгрузка не пошла: прогресса нет вовсе.
    await expect(page.locator("#fetch-progress")).toHaveCount(0);
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });

  test("адрес youtube.com, но не страница канала", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Начать" }).click();

    await expectFieldError(
      page,
      "Адрес канала",
      "channelUrl-error",
      "Адрес не похож на страницу канала",
    );
  });

  test("ноль в количестве отклоняется с сообщением", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("0");
    await page.getByRole("button", { name: "Начать" }).click();

    await expectFieldError(
      page,
      "Количество",
      "count-error",
      "Количество — целое число больше нуля",
    );
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });

  test("несколько ошибок показываются разом", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://vimeo.com/@x");
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("-3");
    await page.getByRole("button", { name: "Начать" }).click();

    // Исправлять ошибки по одной, каждый раз нажимая «Начать», — худший
    // вид общения с формой.
    await expect(page.locator("#channelUrl-error")).toBeVisible();
    await expect(page.locator("#count-error")).toBeVisible();
  });

  test("после исправления выгрузка проходит", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://vimeo.com/@x");
    await page.getByRole("button", { name: "Начать" }).click();
    await expect(page.locator("#channelUrl-error")).toBeVisible();

    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("4");
    await page.getByRole("button", { name: "Начать" }).click();

    await expect(page.locator("#channelUrl-error")).toHaveCount(0);
    await expect(page.locator("tbody tr")).toHaveCount(4, { timeout: 60_000 });
  });
});
