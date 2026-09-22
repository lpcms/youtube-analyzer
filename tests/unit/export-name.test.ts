import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  exportFileName,
  safeTitle,
  snapshotFileName,
} from "@/lib/export/file-name";

const FETCHED = new Date(Date.UTC(2026, 8, 21, 14, 21));

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";

describe("имя файла выгрузки", () => {
  it("состоит из названия канала и даты", () => {
    expect(exportFileName("Канал для E2E", FETCHED)).toBe("Канал для E2E-2026-09-21.xlsx");
  });

  it("дата берётся в UTC, а не по часам машины", () => {
    // Полночь UTC первого числа — это ещё тридцать первое в минусовых зонах.
    // Имя файла не должно зависеть от того, где запущен сервис.
    expect(exportFileName("Канал", new Date(Date.UTC(2026, 0, 1, 0, 0)))).toBe(
      "Канал-2026-01-01.xlsx",
    );
  });

  it("запрещённые в именах файлов символы убираются", () => {
    expect(safeTitle('Тех/Обзор: "всё" про *звук*?')).toBe("Тех Обзор всё про звук");
  });

  it("перевод строки в названии не ломает имя", () => {
    expect(safeTitle("Канал\nвторая строка")).toBe("Канал вторая строка");
  });

  it("название из одних запрещённых символов заменяется словом", () => {
    // Файл с именем «-2026-09-21.xlsx» выглядел бы поломкой.
    expect(exportFileName("///", FETCHED)).toBe("Канал-2026-09-21.xlsx");
    expect(exportFileName("   ", FETCHED)).toBe("Канал-2026-09-21.xlsx");
  });

  it("точки в конце отбрасываются", () => {
    // Windows молча съедает их сам, и имя перестаёт совпадать с ожидаемым.
    expect(safeTitle("Канал...")).toBe("Канал");
  });

  it("очень длинное название обрезается", () => {
    const long = "Очень длинное название канала ".repeat(10);
    const name = exportFileName(long, FETCHED);

    expect(name.length).toBeLessThanOrEqual(60 + "-2026-09-21.xlsx".length);
    expect(name.endsWith("-2026-09-21.xlsx")).toBe(true);
  });
});

describe("имя снимка в history/", () => {
  it("состоит из названия канала, его идентификатора и времени выгрузки", () => {
    expect(snapshotFileName("Канал для E2E", CHANNEL_ID, FETCHED)).toBe(
      `Канал для E2E-${CHANNEL_ID}-2026-09-21_14-21-00.xlsx`,
    );
  });

  it("идентификатор канала есть даже у канала без пригодного названия", () => {
    // Иначе два канала из одних эмодзи легли бы в папку под одним именем.
    expect(snapshotFileName("🔥🔥🔥", CHANNEL_ID, FETCHED)).toBe(
      `🔥🔥🔥-${CHANNEL_ID}-2026-09-21_14-21-00.xlsx`,
    );
    expect(snapshotFileName("///", CHANNEL_ID, FETCHED)).toBe(
      `Канал-${CHANNEL_ID}-2026-09-21_14-21-00.xlsx`,
    );
  });

  it("косые в названии не разводят снимок по подпапкам", () => {
    // Обе косые и двоеточие — разделители пути, а не буквы названия.
    const name = snapshotFileName("Тех\\Обзор/Звук: сезон", CHANNEL_ID, FETCHED);

    expect(name).toBe(`Тех Обзор Звук сезон-${CHANNEL_ID}-2026-09-21_14-21-00.xlsx`);
    expect(name).not.toMatch(/[\\/:]/);
  });

  it("кириллица и пробелы остаются как есть", () => {
    expect(safeTitle("Канал про звук")).toBe("Канал про звук");
  });

  it("две выгрузки одного канала в один день различаются временем", () => {
    const morning = new Date(Date.UTC(2026, 8, 21, 9, 5, 3));
    const evening = new Date(Date.UTC(2026, 8, 21, 21, 40, 59));

    expect(snapshotFileName("Канал", CHANNEL_ID, morning)).toBe(
      `Канал-${CHANNEL_ID}-2026-09-21_09-05-03.xlsx`,
    );
    expect(snapshotFileName("Канал", CHANNEL_ID, evening)).toBe(
      `Канал-${CHANNEL_ID}-2026-09-21_21-40-59.xlsx`,
    );
  });

  it("время берётся в UTC, а не по часам машины", () => {
    expect(snapshotFileName("Канал", CHANNEL_ID, new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe(
      `Канал-${CHANNEL_ID}-2026-01-01_00-00-00.xlsx`,
    );
  });
});

describe("заголовок Content-Disposition", () => {
  it("отдаёт имя вложением, в UTF-8 и с запасным латинским", () => {
    const header = contentDisposition("Канал для E2E-2026-09-21.xlsx", FETCHED);

    expect(header.startsWith("attachment;")).toBe(true);
    // Кириллицу в обычном filename браузеры разбирают по-разному.
    expect(header).toContain('filename="youtube-2026-09-21.xlsx"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("Канал для E2E-2026-09-21.xlsx"));
  });

  it("в заголовке нет символов, которые его порвут", () => {
    // Переводы строк в заголовке — это расщепление ответа, а не косметика.
    const header = contentDisposition(exportFileName("Канал\r\nX-Evil: 1", FETCHED), FETCHED);

    expect(header).not.toMatch(/[\r\n]/);
  });
});
