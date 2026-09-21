/**
 * Выгрузка канала: разрешение адреса, получение видео, запись в SQLite.
 *
 * Трассирующая пуля: пока берёт фиксированное число последних видео обоих
 * типов. Количество, галочки типов и прогресс добавят задачи фазы 2.
 */

import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { YouTubeApiError } from "@/lib/youtube/api";
import { resolveChannel } from "@/lib/youtube/resolve-channel";
import { fetchChannelVideos, type FetchLimit } from "@/lib/youtube/videos";
import type { ConfirmOptions } from "@/lib/youtube/shorts-check";

/**
 * Сколько видео выгружать по умолчанию. `null` — весь канал: постраничный
 * обход работает, и ограничивать выгрузку без просьбы пользователя незачем.
 * Поле количества в форме добавит T-07.
 */
export const DEFAULT_LIMIT: FetchLimit = null;

export type FetchChannelResult =
  | { readonly ok: true; readonly channelId: string; readonly fetchRunId: string }
  | { readonly ok: false; readonly error: FetchChannelError };

export type FetchChannelError =
  | { readonly kind: "invalid-url"; readonly detail: "empty" | "foreign-host" | "unrecognized" }
  | { readonly kind: "not-found" }
  | { readonly kind: "api"; readonly reason: string; readonly message: string };

/**
 * Выгружает канал и сохраняет результат.
 *
 * Клиент Prisma передаётся аргументом, чтобы интеграционный тест мог подсунуть
 * тестовую базу вместо рабочей.
 */
export async function fetchChannel(
  rawUrl: string,
  options: { limit?: FetchLimit; prisma?: PrismaClient; shorts?: ConfirmOptions } = {},
): Promise<FetchChannelResult> {
  // undefined означает «не указано» и даёт умолчание; null — осознанное «все».
  const limit = options.limit === undefined ? DEFAULT_LIMIT : options.limit;
  const db = options.prisma ?? defaultPrisma;

  const resolved = await resolveChannel(rawUrl);
  if (!resolved.ok) {
    return resolved.failure.reason === "invalid-url"
      ? { ok: false, error: { kind: "invalid-url", detail: resolved.failure.detail } }
      : { ok: false, error: { kind: "not-found" } };
  }

  const channel = resolved.channel;

  let videos;
  try {
    videos = await fetchChannelVideos(channel.uploadsPlaylistId, limit, options.shorts ?? {});
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      return { ok: false, error: { kind: "api", reason: e.kind, message: e.message } };
    }
    throw e;
  }

  const now = new Date();

  await db.channel.upsert({
    where: { id: channel.id },
    // Канал мог сменить название, хэндл или аватар со времён прошлой выгрузки.
    update: {
      title: channel.title,
      handle: channel.handle,
      thumbnailUrl: channel.thumbnailUrl,
      uploadsPlaylistId: channel.uploadsPlaylistId,
      lastFetchedAt: now,
    },
    create: {
      id: channel.id,
      title: channel.title,
      handle: channel.handle,
      thumbnailUrl: channel.thumbnailUrl,
      uploadsPlaylistId: channel.uploadsPlaylistId,
      lastFetchedAt: now,
    },
  });

  const run = await db.fetchRun.create({
    data: {
      channelId: channel.id,
      status: "SUCCEEDED",
      startedAt: now,
      finishedAt: new Date(),
      requestedLimit: limit,
      processedCount: videos.length,
      expectedCount: videos.length,
    },
  });

  // Видео пишутся поштучно: upsert одним запросом на все строки не выражается,
  // а семантика «есть — обнови, нет — заведи» здесь обязательна.
  for (const video of videos) {
    await db.video.upsert({
      where: { id: video.id },
      // Неизменное всё же обновляем: автор может переименовать видео
      // или переписать описание.
      update: {
        title: video.title,
        description: video.description,
        durationSec: video.durationSec,
        kind: video.kind,
        kindAssumed: video.kindAssumed,
        lastSeenAt: now,
        goneAt: null,
      },
      create: {
        id: video.id,
        channelId: channel.id,
        kind: video.kind,
        kindAssumed: video.kindAssumed,
        durationSec: video.durationSec,
        publishedAt: video.publishedAt,
        title: video.title,
        description: video.description,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  }

  // Метрики — снимок этой выгрузки, прежние не трогаем. Строки заведомо новые
  // (выгрузка только что создана), поэтому одна вставка вместо сотен.
  if (videos.length > 0) {
    await db.videoStat.createMany({
      data: videos.map((video) => ({
        videoId: video.id,
        fetchRunId: run.id,
        viewCount: video.viewCount,
        likeCount: video.likeCount,
        commentCount: video.commentCount,
      })),
    });
  }

  return { ok: true, channelId: channel.id, fetchRunId: run.id };
}

export interface VideoRow {
  readonly id: string;
  readonly kind: "VIDEO" | "SHORTS";
  /** Тип выведен только из длительности — подтвердить не удалось. */
  readonly kindAssumed: boolean;
  readonly publishedAt: Date;
  readonly viewCount: number | null;
}

/** Строки таблицы для выгрузки: метрики берутся из её собственного снимка. */
export async function videoRows(
  fetchRunId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<readonly VideoRow[]> {
  const db = options.prisma ?? defaultPrisma;

  const stats = await db.videoStat.findMany({
    where: { fetchRunId },
    include: { video: true },
    orderBy: { video: { publishedAt: "desc" } },
  });

  return stats.map((stat) => ({
    id: stat.videoId,
    kind: stat.video.kind,
    kindAssumed: stat.video.kindAssumed,
    publishedAt: stat.video.publishedAt,
    viewCount: stat.viewCount,
  }));
}

/** Последняя выгрузка канала — её и показываем, когда страница перезагружена. */
export async function latestRun(
  channelId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<string | null> {
  const db = options.prisma ?? defaultPrisma;
  const run = await db.fetchRun.findFirst({
    where: { channelId },
    orderBy: { startedAt: "desc" },
  });
  return run?.id ?? null;
}
