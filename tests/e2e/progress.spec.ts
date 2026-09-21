import { expect, test } from "@playwright/test";

/**
 * Прогресс выгрузки.
 *
 * Заглушка отвечает на каждую страницу с задержкой (MOCK_PAGE_DELAY_MS),
 * поэтому промежуточное состояние успевает попасть в кадр. Без задержки
 * канал из 137 видео выгружался бы быстрее, чем тест посмотрит на прогресс.
 */

const TOTAL = 137;

test.describe("ход выгрузки", () => {
  test("во время выгрузки виден прогресс, а «Начать» недоступна", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");

    const start = page.getByRole("button", { name: "Начать" });
    await expect(start).toBeEnabled();
    await start.click();

    const progress = page.locator("#fetch-progress");
    await expect(progress).toBeVisible();
    // Оценка объёма появляется после первой сохранённой страницы: до неё
    // API ещё не сказал, сколько всего видео на канале.
    await expect(progress).toHaveText(/Получено \d+ из ~137 видео/, { timeout: 30_000 });

    // Пока задание идёт, повторное нажатие невозможно.
    await expect(page.getByRole("button", { name: "Выгружаю…" })).toBeDisabled();

    await expect(progress).toHaveText(`Готово: ${TOTAL}`, { timeout: 60_000 });
    // Таблица показывает первую страницу, всего строк — в подписи под ней.
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await expect(start).toBeEnabled();
  });

  test("число в прогрессе растёт, а не скачет сразу к итогу", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();

    const progress = page.locator("#fetch-progress");
    const seen = new Set<string>();

    // Снимаем показания, пока выгрузка идёт.
    for (let i = 0; i < 40; i += 1) {
      const text = await progress.textContent();
      if (text !== null) seen.add(text.trim());
      if (text?.startsWith("Готово") === true) break;
      await page.waitForTimeout(150);
    }

    const intermediate = [...seen].filter((t) => t.startsWith("Получено"));
    expect(intermediate.length).toBeGreaterThan(0);
    // Хотя бы одно промежуточное значение меньше итога.
    expect(
      intermediate.some((t) => {
        const n = Number(/Получено (\d+)/.exec(t)?.[1] ?? "0");
        return n > 0 && n < TOTAL;
      }),
    ).toBe(true);
  });

  test("перезагрузка страницы во время выгрузки не теряет задание", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();

    // Ждём, пока задание попадёт в адрес страницы.
    await expect(page).toHaveURL(/[?&]run=/, { timeout: 30_000 });
    const urlWithRun = page.url();

    await page.reload();

    // После перезагрузки прогресс подхватывается тем же заданием —
    // выгрузка идёт на сервере и от вкладки не зависит.
    expect(page.url()).toBe(urlWithRun);
    const progress = page.locator("#fetch-progress");
    await expect(progress).toBeVisible({ timeout: 30_000 });
    await expect(progress).toHaveText(`Готово: ${TOTAL}`, { timeout: 60_000 });
    await expect(page.locator("tbody tr")).toHaveCount(50);
  });

  test("чужой идентификатор задания объясняется, а не молчит", async ({ page }) => {
    await page.goto("/?run=нет-такого-задания");

    await expect(page.getByText(/Эта выгрузка не найдена/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });
});
