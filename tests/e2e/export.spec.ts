import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Выгрузка таблицы в Excel.
 *
 * Скачанный файл здесь не просто проверяется на непустоту, а открывается той же
 * библиотекой, что и Excel: иначе «файл скачался» ничего не говорит о том,
 * что в нём.
 */

const TOTAL = 137;
const PAGE_SIZE = 50;

async function fetchChannel(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(PAGE_SIZE, { timeout: 60_000 });
}

/** Нажимает «Скачать таблицу» и возвращает открытый лист скачанной книги. */
async function download(page: Page): Promise<{ name: string; sheet: ExcelJS.Worksheet }> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    // Кнопка есть и над таблицей, и под ней — обе ведут в одно место.
    page.getByRole("link", { name: "Скачать таблицу" }).first().click(),
  ]);

  const path = await file.path();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);

  const sheet = book.worksheets[0];
  if (sheet === undefined) throw new Error("в скачанной книге нет ни одного листа");

  return { name: file.suggestedFilename(), sheet };
}

test.describe("выгрузка в Excel", () => {
  test("скачивается книга со всеми строками и девятью колонками", async ({ page }) => {
    await fetchChannel(page);

    const { name, sheet } = await download(page);

    // Имя файла — название канала из заглушки и дата выгрузки.
    expect(name).toMatch(/^Канал для E2E-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual([
      "URL",
      "Тип",
      "Длительность",
      "Просмотры",
      "Лайки",
      "Комментарии",
      "Вирусность",
      "Дата",
      "Описание",
    ]);

    // На экране была видна полсотни строк, в файле — вся выгрузка.
    expect(sheet.rowCount).toBe(TOTAL + 1);
  });

  test("порядок строк в файле совпадает с выбранной сортировкой", async ({ page }) => {
    await fetchChannel(page);

    await page.getByRole("button", { name: /Просмотры/ }).click();
    await expect(page.getByRole("columnheader", { name: /Просмотры/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    const { sheet } = await download(page);
    const views = Array.from({ length: TOTAL }, (_, i) =>
      Number(sheet.getRow(i + 2).getCell(4).value),
    );

    expect(views).toEqual([...views].sort((a, b) => b - a));
  });

  test("в файле ссылка рабочая, число числом, дата датой", async ({ page }) => {
    await fetchChannel(page);

    const { sheet } = await download(page);
    const first = sheet.getRow(2);

    const link = first.getCell(1).value as { text: string; hyperlink: string };
    expect(link.hyperlink).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);

    expect(typeof first.getCell(4).value).toBe("number");
    expect(first.getCell(8).value).toBeInstanceOf(Date);
  });
});
