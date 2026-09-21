import { expect, test, type Page } from "@playwright/test";

/**
 * Сортировка таблицы.
 *
 * Порядок задаётся базе, поэтому проверяется на полной выгрузке из 137 строк:
 * на паре строк «сортировка по всей выгрузке» ничего бы не доказала.
 */

const TOTAL = 137;

async function fetchChannel(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(TOTAL, { timeout: 60_000 });
}

/**
 * Ждёт, пока в первой строке появится ожидаемое значение.
 *
 * Заголовок переключается сразу, а строки приходят с сервера позже: без
 * этого ожидания тест читал бы ещё старый порядок.
 */
async function expectFirstCell(page: Page, nth: number, text: string): Promise<void> {
  await expect(page.locator("tbody tr").first().locator(`td:nth-child(${nth})`)).toHaveText(text, {
    timeout: 15_000,
  });
}

/** Числа колонки как есть, «н/д» отдельным признаком. */
async function column(page: Page, nth: number): Promise<Array<number | null>> {
  const texts = await page.locator(`tbody tr td:nth-child(${nth})`).allInnerTexts();
  return texts.map((t) => {
    const clean = t.trim();
    if (clean === "н/д") return null;
    return Number(clean.replace(/\s/g, "").replace(",", "."));
  });
}

test.describe("сортировка", () => {
  test("клик по «Просмотры» ставит самое просматриваемое первым", async ({ page }) => {
    await fetchChannel(page);

    await page.getByRole("button", { name: /Просмотры/ }).click();
    // Самое просматриваемое в заглушке — последнее по номеру.
    await expectFirstCell(page, 4, String(1000 * TOTAL).replace(/\B(?=(\d{3})+$)/g, " "));

    const views = await column(page, 4);
    const numbers = views.filter((v): v is number => v !== null);

    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(numbers[0]).toBe(1000 * TOTAL);
  });

  test("повторный клик переворачивает направление", async ({ page }) => {
    await fetchChannel(page);

    const header = page.getByRole("button", { name: /Просмотры/ });
    await header.click();
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    await header.click();
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expectFirstCell(page, 4, "1 000");

    const views = (await column(page, 4)).filter((v): v is number => v !== null);
    expect(views).toEqual([...views].sort((a, b) => a - b));
  });

  test("сортировка охватывает всю выгрузку, а не видимую часть", async ({ page }) => {
    await fetchChannel(page);

    await page.getByRole("button", { name: /Длительность/ }).click();
    // В заглушке Shorts по 45 секунд, обычные по 10 минут. По возрастанию
    // первой должна идти сорокапятисекундная, последней — десятиминутная.
    await expectFirstCell(page, 3, "0:45");

    const durations = await page.locator("tbody tr td:nth-child(3)").allInnerTexts();
    expect(durations[0]?.trim()).toBe("0:45");
    expect(durations[durations.length - 1]?.trim()).toBe("10:00");
  });

  test("строки с «н/д» уходят в конец при любом направлении", async ({ page }) => {
    await fetchChannel(page);

    // В заглушке лайки равны 10 × (номер + 1), у каждого третьего скрыты.
    const biggest = "1 370";
    const smallest = "20";

    for (const [expected, first] of [
      ["descending", biggest],
      ["ascending", smallest],
    ] as const) {
      await page.getByRole("button", { name: /Лайки/ }).click();
      await expect(page.getByRole("columnheader", { name: /Лайки/ })).toHaveAttribute(
        "aria-sort",
        expected,
      );
      await expectFirstCell(page, 5, first);

      const likes = await column(page, 5);
      const firstNull = likes.indexOf(null);
      expect(firstNull).toBeGreaterThan(0);
      // После первого «н/д» ничего, кроме «н/д», быть не должно.
      expect(likes.slice(firstNull).every((v) => v === null)).toBe(true);
    }
  });

  test("направление объявляется скринридеру, у несортируемых колонок его нет", async ({ page }) => {
    await fetchChannel(page);

    // До первого клика активна сортировка по дате.
    await expect(page.getByRole("columnheader", { name: /Дата/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(page.getByRole("columnheader", { name: /Вирусность/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
    await expect(page.getByRole("columnheader", { name: "URL" })).not.toHaveAttribute("aria-sort");
    await expect(page.getByRole("columnheader", { name: "Описание" })).not.toHaveAttribute(
      "aria-sort",
    );
  });
});
