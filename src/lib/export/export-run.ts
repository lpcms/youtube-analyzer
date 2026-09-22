/**
 * Выгрузка одного запуска в книгу Excel.
 *
 * Отделено от маршрута: маршрут занят разбором запроса и заголовками ответа,
 * а здесь — собственно работа, которую можно прогнать в тесте на тестовой базе,
 * не поднимая сервер.
 */

import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { videoRows } from "@/lib/fetch-channel";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { DEFAULT_SORT, type SortSpec } from "@/lib/sorting";
import { exportFileName } from "./file-name";
import { buildWorkbook } from "./workbook";

export type ExportResult =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly fetchedAt: Date;
      // Канал отдаётся вместе с книгой, чтобы снимку в history/ не пришлось
      // вторым запросом выяснять то, что здесь уже прочитано.
      readonly channelId: string;
      readonly channelTitle: string;
      // Именно Uint8Array<ArrayBuffer>: только такой массив Response
      // принимает телом ответа.
      readonly file: Uint8Array<ArrayBuffer>;
    }
  | { readonly ok: false; readonly reason: "not-found" };

export async function exportRun(
  fetchRunId: string,
  options: { prisma?: PrismaClient; sort?: SortSpec } = {},
): Promise<ExportResult> {
  const db = options.prisma ?? defaultPrisma;
  const sort = options.sort ?? DEFAULT_SORT;

  const run = await db.fetchRun.findUnique({
    where: { id: fetchRunId },
    include: { channel: true },
  });
  if (run === null) return { ok: false, reason: "not-found" };

  // Все строки выгрузки, а не текущая страница: страницы — способ смотреть,
  // а не часть данных.
  const rows = await videoRows(fetchRunId, { prisma: db, sort });

  const fetchedAt = run.startedAt;
  const channelTitle = run.channel.title;

  return {
    ok: true,
    fileName: exportFileName(channelTitle, fetchedAt),
    fetchedAt,
    channelId: run.channelId,
    channelTitle,
    file: await buildWorkbook(rows, { channelTitle, fetchedAt }),
  };
}
