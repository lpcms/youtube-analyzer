import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Доступность: axe на обеих страницах сервиса — на форме и на таблице.
 *
 * Проверка идёт по настоящей странице в настоящем браузере: половина правил
 * axe смотрит на вычисленные стили и на дерево доступности, а их в jsdom
 * попросту нет.
 *
 * Правила берутся уровней A и AA: AAA требует, например, контраста 7:1,
 * и гнаться за ним в служебной таблице значило бы красить её в чёрно-белое.
 */

const LEVELS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const PAGE_SIZE = 50;

/** Находки axe в читаемом виде: иначе в отчёте будет стена JSON. */
function describe(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? "—"}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`,
    )
    .join("\n\n");
}

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(LEVELS).analyze();
}

test.describe("доступность", () => {
  test("страница формы — без нарушений", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Начать" })).toBeVisible();

    const { violations } = await scan(page);

    expect(describe(violations)).toBe("");
  });

  test("страница с таблицей — без нарушений", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE, { timeout: 60_000 });

    const { violations } = await scan(page);

    expect(describe(violations)).toBe("");
  });

  test("таблица и форма проходятся с клавиатуры", async ({ page }) => {
    await page.goto("/");

    // От начала страницы до кнопки «Начать» — только табуляцией.
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Адрес канала")).toBeFocused();

    for (let i = 0; i < 10; i += 1) {
      if (
        await page
          .getByRole("button", { name: "Начать" })
          .evaluate((el) => el === document.activeElement)
      )
        break;
      await page.keyboard.press("Tab");
    }

    await expect(page.getByRole("button", { name: "Начать" })).toBeFocused();
  });
});
