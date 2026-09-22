import { expect, test, type Page } from "@playwright/test";

/**
 * Повторная выгрузка канала.
 *
 * Заглушка отдаёт один и тот же канал в двух состояниях: хэндл в адресе
 * выбирает, какое именно. Так тест устраивает настоящую жизнь канала —
 * два ролика пропали, один появился, — не полагаясь ни на порядок тестов,
 * ни на то, что заглушку перезапустили.
 */

const BEFORE = 10;
const AFTER = 9;
const VANISHED = 2;

const GEN1 = "https://www.youtube.com/@e2e-gen1";
const GEN2 = "https://www.youtube.com/@e2e-gen2";

async function fetchChannel(page: Page, url: string, expectedRows: number): Promise<void> {
  await page.getByLabel("Адрес канала").fill(url);
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(expectedRows, { timeout: 60_000 });
}

test.describe("повторное «Начать»", () => {
  test("после изменений на канале число строк меняется, пропажи названы", async ({ page }) => {
    await page.goto("/");

    await fetchChannel(page, GEN1, BEFORE);
    await expect(page.locator("#row-count-top")).toHaveText(new RegExp(`из\\s*${BEFORE}`));
    await expect(page.locator("#fetch-progress")).toHaveText(`Готово: ${BEFORE}`);

    // Тот же канал, но два ролика с него пропали, а один добавился.
    await fetchChannel(page, GEN2, AFTER);

    await expect(page.locator("#row-count-top")).toHaveText(new RegExp(`из\\s*${AFTER}`));
    await expect(page.locator("#fetch-progress")).toHaveText(
      `Готово: ${AFTER}. Исчезло с канала: ${VANISHED}`,
    );
  });

  test("появившийся ролик виден в таблице, пропавших в ней нет", async ({ page }) => {
    await page.goto("/");

    await fetchChannel(page, GEN1, BEFORE);
    const before = await page
      .locator("tbody tr")
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));

    await fetchChannel(page, GEN2, AFTER);
    const after = await page
      .locator("tbody tr")
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));

    // Один адрес новый, двух прежних не стало.
    const appeared = after.filter((href) => !before.includes(href));
    const vanished = before.filter((href) => !after.includes(href));

    expect(appeared).toHaveLength(1);
    expect(vanished).toHaveLength(VANISHED);
  });

  test("выгрузка без изменений никого не хоронит", async ({ page }) => {
    await page.goto("/");

    await fetchChannel(page, GEN1, BEFORE);
    await fetchChannel(page, GEN1, BEFORE);

    // Ни слова о пропажах: их и не было.
    await expect(page.locator("#fetch-progress")).toHaveText(`Готово: ${BEFORE}`);
    await expect(page.locator("#row-count-top")).toHaveText(new RegExp(`из\\s*${BEFORE}`));
  });

  test("выгрузка с ограничением по количеству не объявляет остальных пропавшими", async ({
    page,
  }) => {
    await page.goto("/");

    await fetchChannel(page, GEN1, BEFORE);

    // Просим три ролика: остальные не запрашивали, а не потеряли.
    await page.getByRole("checkbox", { name: "Все видео" }).uncheck();
    await page.getByLabel("Количество").fill("3");
    await fetchChannel(page, GEN1, 3);

    await expect(page.locator("#fetch-progress")).toHaveText("Готово: 3");

    // И следующая полная выгрузка снова показывает все десять.
    await page.getByRole("checkbox", { name: "Все видео" }).check();
    await fetchChannel(page, GEN1, BEFORE);
    await expect(page.locator("#fetch-progress")).toHaveText(`Готово: ${BEFORE}`);
  });
});
