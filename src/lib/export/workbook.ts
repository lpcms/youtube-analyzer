/**
 * Сборка книги Excel из строк выгрузки.
 *
 * Книга строится на сервере, а не в браузере: выгрузка канала бывает
 * в десятки тысяч строк, и собирать такой файл в главном потоке вкладки
 * значит подвесить её на всё время. Заодно библиотека не попадает
 * в клиентский бандл — `server-only` это и стережёт.
 */

import "server-only";

import type { VideoRow } from "@/lib/fetch-channel";
import { WORKBOOK_COLUMNS } from "@/lib/table-columns";
import { videoUrl } from "@/lib/youtube/video-url";

/** То же, что показывает таблица: «н/д» вместо пустой ячейки. */
const NO_DATA = "н/д";

const KIND_LABEL = { VIDEO: "Video", SHORTS: "Shorts" } as const;

const ASSUMED_NOTE = "Тип определён по длительности: подтвердить через страницу Shorts не удалось";

/** Предел Excel на длину текста в ячейке. Описания бывают длиннее. */
const MAX_CELL_TEXT = 32_767;

/** Ширины колонок в знаках — на глаз, чтобы файл открывался читаемым. */
const WIDTH: Record<string, number> = {
  url: 44,
  title: 46,
  kind: 10,
  durationSec: 13,
  viewCount: 14,
  likeCount: 12,
  commentCount: 14,
  viralityScore: 12,
  publishedAt: 18,
  description: 60,
};

const SECONDS_PER_DAY = 86_400;

export interface WorkbookMeta {
  readonly channelTitle: string;
  readonly fetchedAt: Date;
}

/**
 * Строит `.xlsx` и отдаёт его байтами.
 *
 * Библиотека подключается динамическим import: она тяжёлая, а нужна только
 * в момент нажатия «Скачать таблицу», и держать её в памяти сервера всё
 * остальное время незачем.
 */
export async function buildWorkbook(
  rows: readonly VideoRow[],
  meta: WorkbookMeta,
): Promise<Uint8Array<ArrayBuffer>> {
  const { Workbook } = await import("exceljs");

  const book = new Workbook();
  book.creator = "youtube_analyzer";
  // Свойства файла помнят, чей это канал и когда снят срез: имя файла
  // пользователь переименует, а свойства останутся.
  book.title = meta.channelTitle;
  book.created = meta.fetchedAt;

  const sheet = book.addWorksheet("Видео", {
    // Шапка остаётся на месте при прокрутке — иначе на сотой строке
    // уже не вспомнить, где какая колонка.
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = WORKBOOK_COLUMNS.map((column) => ({
    key: column.key,
    header: column.label,
    width: WIDTH[column.key] ?? 14,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: WORKBOOK_COLUMNS.length },
  };

  for (const row of rows) {
    const line = sheet.addRow({
      // Название отдельной колонкой: на экране оно подпись под ссылкой,
      // а в книге по нему фильтруют и сортируют наравне с остальным.
      title: row.title,
      kind: KIND_LABEL[row.kind],
      // Длительность — время Excel, то есть доля суток. Так она и сортируется,
      // и суммируется, и показывается как 0:12:05, а не как 725.
      durationSec: row.durationSec / SECONDS_PER_DAY,
      viewCount: row.viewCount ?? NO_DATA,
      likeCount: row.likeCount ?? NO_DATA,
      commentCount: row.commentCount ?? NO_DATA,
      viralityScore: row.viralityScore ?? NO_DATA,
      publishedAt: row.publishedAt,
      description: row.description.slice(0, MAX_CELL_TEXT),
    });

    // Ссылка задаётся отдельно: нужна рабочая гиперссылка, а не текст,
    // похожий на адрес.
    const url = videoUrl(row.id);
    const link = line.getCell("url");
    link.value = { text: url, hyperlink: url };
    link.font = { color: { argb: "FF0563C1" }, underline: true };

    if (row.kindAssumed) {
      // Догадка помечается примечанием, а не знаком вопроса в самом значении:
      // иначе фильтр по типу перестал бы собирать такие строки вместе.
      line.getCell("kind").note = ASSUMED_NOTE;
    }

    line.getCell("durationSec").numFmt = "[h]:mm:ss";
    for (const key of ["viewCount", "likeCount", "commentCount"]) {
      line.getCell(key).numFmt = "#,##0";
    }
    line.getCell("viralityScore").numFmt = "0.0";
    // Тот же вид, что и в таблице: 2026-09-21 14:21.
    line.getCell("publishedAt").numFmt = "yyyy-mm-dd hh:mm";
    line.getCell("description").alignment = { wrapText: false, vertical: "top" };
  }

  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
