/**
 * Снимок выгрузки на диске.
 *
 * После успешной выгрузки в `history/` ложится тот же `.xlsx`, что отдаёт
 * «Скачать таблицу», — файл, который открывается вне сервиса и переживает
 * его самого.
 *
 * Это архив, а не хранилище. Данные всегда читаются из SQLite, и удалённая
 * папка ничего не ломает: список каналов, таблицы и повторные выгрузки
 * работают так же, как с ней. Обратное — чтение строк из этих файлов —
 * запрещено: если такой соблазн возникнет, значит, нужного поля не хватает
 * в схеме базы.
 */

import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { exportRun } from "./export-run";
import { snapshotFileName } from "./file-name";

/**
 * Куда складывать снимки.
 *
 * Обычно это `history/` рядом с проектом. Переменная окружения нужна прогонам:
 * тесты не должны писать в настоящий архив пользователя и тем более чистить его.
 */
export function historyDir(): string {
  const configured = process.env.HISTORY_DIR;
  if (configured === undefined || configured === "") {
    return path.join(process.cwd(), "history");
  }
  return path.resolve(configured);
}

/**
 * Сколько раз пробовать развести имена, если файл с таким именем уже есть.
 *
 * До этого доходит только при двух выгрузках одного канала в одну и ту же
 * секунду. Предел нужен не ради этого случая, а чтобы ошибка в правилах
 * именования не превратилась в вечный цикл.
 */
const MAX_ATTEMPTS = 20;

/** `Канал-UC…-2026-09-21_14-21-05 (2).xlsx` */
function withSuffix(fileName: string, attempt: number): string {
  if (attempt === 1) return fileName;
  const ext = path.extname(fileName);
  return `${fileName.slice(0, fileName.length - ext.length)} (${attempt})${ext}`;
}

/**
 * Пишет файл, не затирая существующий.
 *
 * Флаг `wx` — отказ, если файл уже есть. Проверять существование отдельным
 * вопросом значило бы оставить щель между вопросом и ответом; здесь решает
 * сама файловая система.
 */
async function writeWithoutOverwrite(
  dir: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const written = path.join(dir, withSuffix(fileName, attempt));
    try {
      await writeFile(written, bytes, { flag: "wx" });
      return written;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "EEXIST")) throw e;
    }
  }
  throw new Error(`не удалось подобрать свободное имя для снимка ${fileName}`);
}

/**
 * Кладёт снимок выгрузки в `history/` и запоминает путь к нему.
 *
 * Отказ не бросается наружу: папку могли удалить, диск — заполнить,
 * права — снять, и ни один из этих случаев не повод объявить успешную
 * выгрузку неудачной. Данные уже в базе, а снимок — побочный продукт.
 * Возвращает путь к файлу или `null`, если записать не вышло.
 */
export async function saveSnapshot(
  runId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<string | null> {
  const db = options.prisma ?? defaultPrisma;

  try {
    // Та же книга, что и у «Скачать таблицу»: второй генератор разошёлся бы
    // с первым на первой же правке колонок.
    const result = await exportRun(runId, { prisma: db });
    if (!result.ok) return null;

    const dir = historyDir();
    // Папки может не быть — ни при первой выгрузке, ни после того, как её
    // удалили руками. И то и другое нормально.
    await mkdir(dir, { recursive: true });

    const written = await writeWithoutOverwrite(
      dir,
      snapshotFileName(result.channelTitle, result.channelId, result.fetchedAt),
      result.file,
    );

    // Путь хранится относительно корня проекта и с прямыми косыми: значение
    // не должно меняться от того, на какой машине снят снимок.
    const relative = path.relative(process.cwd(), written).split(path.sep).join("/");

    await db.fetchRun.update({ where: { id: runId }, data: { snapshotPath: relative } });
    return relative;
  } catch (e) {
    console.error("[снимок] не удалось сохранить файл выгрузки", e);
    return null;
  }
}
