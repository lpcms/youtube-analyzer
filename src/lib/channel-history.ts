/**
 * История каналов: список ранее выгруженных и удаление из него.
 *
 * Источник правды — SQLite, и только он. Ни один запрос отсюда не идёт
 * в YouTube: вернуться к уже проанализированному каналу — самое частое
 * действие после первой выгрузки, и стоить квоты оно не должно.
 */

import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ChannelSummary } from "@/lib/channel-summary";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Каналы, известные сервису, свежие сверху.
 *
 * Два запроса вместо одного на канал: счётчики по типам берутся groupBy
 * разом по всей таблице. На десятке каналов разницы нет, но запрос в цикле —
 * это заготовка на будущее замедление.
 */
export async function listChannels(
  options: { prisma?: PrismaClient } = {},
): Promise<ChannelSummary[]> {
  const db = options.prisma ?? defaultPrisma;

  const channels = await db.channel.findMany({
    // Свежие сверху; канал без завершённых выгрузок уходит в конец.
    orderBy: { lastFetchedAt: { sort: "desc", nulls: "last" } },
    include: {
      // Последняя выгрузка — её открывают из истории.
      fetchRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true } },
      _count: { select: { fetchRuns: true } },
    },
  });

  // Исчезнувшие с канала видео в счёт не идут: список показывает, что
  // на канале есть, а не что когда-либо было.
  const counts = await db.video.groupBy({
    by: ["channelId", "kind"],
    where: { goneAt: null },
    _count: { _all: true },
  });

  const countOf = (channelId: string, kind: "VIDEO" | "SHORTS"): number =>
    counts.find((row) => row.channelId === channelId && row.kind === kind)?._count._all ?? 0;

  return channels.map((channel) => ({
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    videoCount: countOf(channel.id, "VIDEO"),
    shortsCount: countOf(channel.id, "SHORTS"),
    lastFetchedAt: channel.lastFetchedAt,
    latestRunId: channel.fetchRuns[0]?.id ?? null,
    runCount: channel._count.fetchRuns,
  }));
}

/**
 * Убирает канал из истории вместе со всем, что к нему относится.
 *
 * Видео и снимки метрик уходят каскадом, описанным в схеме: держать
 * порядок удаления ещё и здесь значило бы завести второй источник правды
 * о связях. Соседние каналы не задеваются — связь у видео ровно одна.
 *
 * Возвращает false, если канала уже нет: удалить дважды — не ошибка,
 * а обычная вторая вкладка.
 */
export async function deleteChannel(
  channelId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<boolean> {
  const db = options.prisma ?? defaultPrisma;

  const { count } = await db.channel.deleteMany({ where: { id: channelId } });
  return count > 0;
}

/**
 * Принадлежит ли выгрузка этому каналу.
 *
 * Нужно перед удалением: страницу уводят с открытой таблицы, только если
 * она вот-вот исчезнет. Сносить чужую таблицу заодно — лишняя потеря.
 */
export async function runBelongsTo(
  fetchRunId: string,
  channelId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<boolean> {
  const db = options.prisma ?? defaultPrisma;

  const run = await db.fetchRun.findUnique({
    where: { id: fetchRunId },
    select: { channelId: true },
  });

  return run?.channelId === channelId;
}
