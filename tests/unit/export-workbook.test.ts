/**
 * @vitest-environment node
 *
 * Книга собирается и тут же читается обратно: проверять надо сам файл,
 * а не намерения кода. Окружение node, а не jsdom, — ExcelJS в браузерной
 * сборке работает иначе, а книгу мы строим на сервере.
 */

import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { exportRun } from "@/lib/export/export-run";
import { buildWorkbook } from "@/lib/export/workbook";
import type { VideoRow } from "@/lib/fetch-channel";
import { COLUMN_LABELS, COLUMNS, type ColumnKey } from "@/lib/table-columns";
import { videoUrl } from "@/lib/youtube/video-url";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";

const META = { channelTitle: "Канал для проверки", fetchedAt: new Date(Date.UTC(2026, 8, 21, 14)) };

const BASE: VideoRow = {
  id: "aaaaaaaaaaa",
  title: "Первое видео",
  kind: "VIDEO",
  kindAssumed: false,
  durationSec: 725,
  publishedAt: new Date(Date.UTC(2026, 8, 21, 14, 21)),
  description: "Описание",
  viewCount: 12_345,
  likeCount: 678,
  commentCount: 90,
  viralityScore: 7.3,
};

function row(overrides: Partial<VideoRow> = {}): VideoRow {
  return { ...BASE, ...overrides };
}

/** Читает собранную книгу обратно — так же, как её прочитает Excel. */
async function read(file: Uint8Array): Promise<ExcelJS.Worksheet> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as unknown as ArrayBuffer);

  const sheet = book.worksheets[0];
  if (sheet === undefined) throw new Error("в книге нет ни одного листа");
  return sheet;
}

/**
 * Номер колонки по её ключу.
 *
 * У прочитанной обратно книги ключей нет: они живут только в памяти ExcelJS
 * и в файл не попадают. Значит, обращаться к ячейкам надо по номеру — и брать
 * его из того же списка колонок, что строит и книгу, и таблицу.
 */
function col(key: ColumnKey): number {
  const index = COLUMNS.findIndex((c) => c.key === key);
  if (index < 0) throw new Error(`нет колонки ${key}`);
  return index + 1;
}

/** Значения шапки: ExcelJS нумерует ячейки с единицы, нулевая пустая. */
function headers(sheet: ExcelJS.Worksheet): unknown[] {
  return (sheet.getRow(1).values as unknown[]).slice(1);
}

describe("книга Excel", () => {
  it("открывается как настоящий .xlsx", async () => {
    const file = await buildWorkbook([row()], META);

    // Сигнатура zip: то, по чему Excel опознаёт файл.
    expect(Array.from(file.slice(0, 2))).toEqual([0x50, 0x4b]);
    await expect(read(file)).resolves.toBeDefined();
  });

  it("содержит те же девять колонок, что и таблица на экране", async () => {
    const sheet = await read(await buildWorkbook([row()], META));

    expect(headers(sheet)).toEqual([...COLUMN_LABELS]);
    expect(COLUMN_LABELS).toHaveLength(9);
  });

  it("строк ровно столько, сколько в выгрузке, плюс шапка", async () => {
    const rows = Array.from({ length: 137 }, (_, i) =>
      row({ id: `v${String(i).padStart(10, "0")}`.slice(0, 11) }),
    );

    const sheet = await read(await buildWorkbook(rows, META));

    expect(sheet.rowCount).toBe(rows.length + 1);
  });

  it("порядок строк сохраняется тот, в котором их отдали", async () => {
    const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"];
    const file = await buildWorkbook(
      ids.map((id) => row({ id })),
      META,
    );

    const sheet = await read(file);
    const links = ids.map(
      (_, i) => (sheet.getRow(i + 2).getCell(1).value as { text: string }).text,
    );

    expect(links).toEqual(ids.map(videoUrl));
  });

  it("URL записан рабочей ссылкой, а не похожим на неё текстом", async () => {
    const sheet = await read(await buildWorkbook([row()], META));

    const cell = sheet.getRow(2).getCell(1).value as { text: string; hyperlink: string };
    expect(cell.hyperlink).toBe(videoUrl(BASE.id));
    expect(cell.text).toBe(videoUrl(BASE.id));
  });

  it("счётчики записаны числами, а не строками с пробелами", async () => {
    const sheet = await read(await buildWorkbook([row()], META));
    const line = sheet.getRow(2);

    expect(line.getCell(col("viewCount")).value).toBe(12_345);
    expect(line.getCell(col("likeCount")).value).toBe(678);
    expect(line.getCell(col("commentCount")).value).toBe(90);
    expect(Number(line.getCell(col("viralityScore")).value)).toBeCloseTo(7.3, 5);
    expect(typeof line.getCell(col("viewCount")).value).toBe("number");
  });

  it("дата записана датой и в том же часовом поясе, что в таблице", async () => {
    const sheet = await read(await buildWorkbook([row()], META));
    const cell = sheet.getRow(2).getCell(col("publishedAt"));

    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString()).toBe(BASE.publishedAt.toISOString());
    expect(cell.numFmt).toBe("yyyy-mm-dd hh:mm");
  });

  it("длительность записана временем, а не строкой «12:05»", async () => {
    const sheet = await read(await buildWorkbook([row({ durationSec: 725 })], META));
    const cell = sheet.getRow(2).getCell(col("durationSec"));

    // Время Excel — доля суток, поэтому 725 секунд читаются обратно
    // как 0 часов 12 минут 5 секунд, а не как текст.
    const value = cell.value as Date;
    expect(value).toBeInstanceOf(Date);
    expect(value.getUTCHours()).toBe(0);
    expect(value.getUTCMinutes()).toBe(12);
    expect(value.getUTCSeconds()).toBe(5);
    expect(cell.numFmt).toBe("[h]:mm:ss");
  });

  it("скрытая автором статистика — «н/д», а не ноль", async () => {
    const hidden = row({
      viewCount: 100,
      likeCount: null,
      commentCount: null,
      viralityScore: null,
    });

    const sheet = await read(await buildWorkbook([hidden], META));
    const line = sheet.getRow(2);

    expect(line.getCell(col("likeCount")).value).toBe("н/д");
    expect(line.getCell(col("commentCount")).value).toBe("н/д");
    expect(line.getCell(col("viralityScore")).value).toBe("н/д");
  });

  it("ноль остаётся нулём: это другое утверждение о мире", async () => {
    const sheet = await read(await buildWorkbook([row({ likeCount: 0 })], META));

    expect(sheet.getRow(2).getCell(col("likeCount")).value).toBe(0);
  });

  it("невыясненный тип помечен примечанием, а не знаком вопроса в значении", async () => {
    const assumed = row({ kind: "SHORTS", kindAssumed: true });

    const sheet = await read(await buildWorkbook([assumed], META));
    const cell = sheet.getRow(2).getCell(col("kind"));

    // Значение чистое, иначе фильтр в Excel перестал бы собирать
    // такие строки вместе с остальными Shorts.
    expect(cell.value).toBe("Shorts");
    expect(JSON.stringify(cell.note)).toContain("по длительности");
  });

  it("описание переносится целиком, но не длиннее предела Excel", async () => {
    const long = "я".repeat(40_000);

    const sheet = await read(await buildWorkbook([row({ description: long })], META));

    expect(String(sheet.getRow(2).getCell(col("description")).value)).toHaveLength(32_767);
  });

  it("пустая выгрузка даёт файл с одной шапкой", async () => {
    const sheet = await read(await buildWorkbook([], META));

    expect(headers(sheet)).toEqual([...COLUMN_LABELS]);
    expect(sheet.rowCount).toBe(1);
  });
});

describe("выгрузка запуска из базы", () => {
  const TOTAL = 137;

  async function seed(): Promise<string> {
    const channel = await makeChannel({ title: "Канал для проверки" });
    const run = await makeFetchRun({
      channelId: channel.id,
      startedAt: new Date(Date.UTC(2026, 8, 21, 14, 0)),
    });

    for (let i = 0; i < TOTAL; i += 1) {
      const video = await makeVideo({
        channelId: channel.id,
        publishedAt: new Date(Date.UTC(2026, 0, 1 + i, 12, 0)),
      });
      await makeVideoStat({ videoId: video.id, fetchRunId: run.id, viewCount: (i + 1) * 100 });
    }

    return run.id;
  }

  beforeEach(async () => {
    await resetDb();
  });

  it("в файл попадают все строки выгрузки, а не одна страница", async () => {
    const runId = await seed();

    const result = await exportRun(runId, { prisma: testPrisma });
    if (!result.ok) throw new Error("выгрузка не найдена");

    const sheet = await read(result.file);

    expect(sheet.rowCount).toBe(TOTAL + 1);
    expect(headers(sheet)).toEqual([...COLUMN_LABELS]);
  });

  it("порядок строк совпадает с выбранной сортировкой", async () => {
    const runId = await seed();

    const result = await exportRun(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "desc" },
    });
    if (!result.ok) throw new Error("выгрузка не найдена");

    const sheet = await read(result.file);
    const views = Array.from({ length: TOTAL }, (_, i) =>
      Number(sheet.getRow(i + 2).getCell(col("viewCount")).value),
    );

    expect(views[0]).toBe(TOTAL * 100);
    expect(views).toEqual([...views].sort((a, b) => b - a));
  });

  it("имя файла собрано из названия канала и даты выгрузки", async () => {
    const runId = await seed();

    const result = await exportRun(runId, { prisma: testPrisma });
    if (!result.ok) throw new Error("выгрузка не найдена");

    expect(result.fileName).toBe("Канал для проверки-2026-09-21.xlsx");
  });

  it("несуществующая выгрузка не даёт файла", async () => {
    const result = await exportRun("нет-такой-выгрузки", { prisma: testPrisma });

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
