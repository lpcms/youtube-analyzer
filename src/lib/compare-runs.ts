/**
 * Чтение двух выгрузок канала для сравнения.
 *
 * Ни одного обращения к YouTube: оба снимка уже лежат в SQLite, и спрашивать
 * у API прошлое бессмысленно — он помнит только сегодняшние цифры.
 */

import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  compareSnapshots,
  countRows,
  type ComparisonCounts,
  type ComparisonRow,
  type SnapshotRow,
} from "@/lib/comparison";
import { isCompleteSweep } from "@/lib/fetch-job";
import { FIRST_PAGE, clampPage, offsetFor, pageCount, type PageSpec } from "@/lib/pagination";
import { prisma as defaultPrisma } from "@/lib/prisma";

/** Выгрузка в списке выбора дат. */
export interface RunOption {
  readonly id: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /** Сколько строк в снимке: пустые выгрузки сравнивать не с чем. */
  readonly rowCount: number;
  /** Обошла ли выгрузка канал целиком — от этого зависит смысл пометок. */
  readonly complete: boolean;
}

/**
 * Выгрузки канала, которые есть смысл сравнивать, свежие сверху.
 *
 * Пустые не предлагаются: у выгрузки, не собравшей ни строки, сравнивать
 * нечего, а в списке дат она выглядела бы полноценным снимком.
 */
export async function listRuns(
  channelId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<RunOption[]> {
  const db = options.prisma ?? defaultPrisma;

  const runs = await db.fetchRun.findMany({
    where: { channelId, stats: { some: {} } },
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { stats: true } } },
  });

  return runs.map((run) => ({
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    rowCount: run._count.stats,
    // Та же проверка, что решает судьбу goneAt: полным обходом считается
    // только выгрузка без ограничений, обоих типов и дошедшая до конца.
    complete: isCompleteSweep(run, run.errorReason),
  }));
}

export interface Comparison {
  readonly channelId: string;
  readonly channelTitle: string;
  /** Ранний снимок — всегда тот, что раньше начался. */
  readonly before: RunOption;
  readonly after: RunOption;
  /** Строки запрошенной страницы. */
  readonly rows: readonly ComparisonRow[];
  readonly counts: ComparisonCounts;
  /** Всего строк в сравнении, а не на странице. */
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  /** Хотя бы один снимок обошёл канал не целиком — пометки условны. */
  readonly partial: boolean;
}

export type CompareResult =
  | { readonly ok: true; readonly comparison: Comparison }
  | { readonly ok: false; readonly reason: "not-found" | "other-channel" | "same-run" };

/** Снимок целиком: обе выгрузки читаются разом, объединять их построчно негде. */
async function snapshotOf(db: PrismaClient, fetchRunId: string): Promise<SnapshotRow[]> {
  const stats = await db.videoStat.findMany({
    where: { fetchRunId },
    // Описание и длительность сравнению не нужны — они не меняются,
    // и тащить их из базы ради двух снимков незачем.
    select: {
      videoId: true,
      viewCount: true,
      likeCount: true,
      commentCount: true,
      video: { select: { title: true, kind: true, kindAssumed: true, publishedAt: true } },
    },
  });

  return stats.map((stat) => ({
    id: stat.videoId,
    title: stat.video.title,
    kind: stat.video.kind,
    kindAssumed: stat.video.kindAssumed,
    publishedAt: stat.video.publishedAt,
    viewCount: stat.viewCount,
    likeCount: stat.likeCount,
    commentCount: stat.commentCount,
  }));
}

/**
 * Сравнивает две выгрузки одного канала.
 *
 * Порядок дат не важен: какую из двух выбрали первой, не должно менять знак
 * прироста, поэтому ранняя и поздняя определяются по времени начала, а не
 * по порядку аргументов.
 *
 * Страница отрезается уже от сведённых строк, а не запросом к базе:
 * объединение двух снимков — не таблица, и выразить его одним SELECT
 * с limit и offset не выйдет.
 */
export async function compareRuns(
  firstRunId: string,
  secondRunId: string,
  options: { prisma?: PrismaClient; page?: PageSpec } = {},
): Promise<CompareResult> {
  const db = options.prisma ?? defaultPrisma;
  const requested = options.page ?? FIRST_PAGE;

  if (firstRunId === secondRunId) return { ok: false, reason: "same-run" };

  const runs = await db.fetchRun.findMany({
    where: { id: { in: [firstRunId, secondRunId] } },
    include: {
      channel: { select: { id: true, title: true } },
      _count: { select: { stats: true } },
    },
  });

  const one = runs[0];
  const two = runs[1];
  if (one === undefined || two === undefined) return { ok: false, reason: "not-found" };
  if (one.channelId !== two.channelId) return { ok: false, reason: "other-channel" };

  const [earlier, later] =
    one.startedAt.getTime() <= two.startedAt.getTime() ? [one, two] : [two, one];

  const option = (run: typeof one): RunOption => ({
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    rowCount: run._count.stats,
    complete: isCompleteSweep(run, run.errorReason),
  });

  const earlierOption = option(earlier);
  const laterOption = option(later);

  const [before, after] = await Promise.all([snapshotOf(db, earlier.id), snapshotOf(db, later.id)]);

  const all = compareSnapshots(before, after);
  const total = all.length;
  const page = clampPage(requested.page, total, requested.pageSize);
  const spec: PageSpec = { page, pageSize: requested.pageSize };

  return {
    ok: true,
    comparison: {
      channelId: earlier.channel.id,
      channelTitle: later.channel.title,
      before: earlierOption,
      after: laterOption,
      rows: all.slice(offsetFor(spec), offsetFor(spec) + spec.pageSize),
      counts: countRows(all),
      total,
      page,
      pageCount: pageCount(total, spec.pageSize),
      partial: !earlierOption.complete || !laterOption.complete,
    },
  };
}
