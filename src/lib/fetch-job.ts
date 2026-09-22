/**
 * Выгрузка как задание.
 *
 * Канал на тысячи роликов выгружается минутами. Дожидаться этого внутри одного
 * запроса нельзя: пользователь видит висящую кнопку, а перезагрузка страницы
 * теряет работу. Поэтому запуск и ожидание разделены:
 *
 *   createRun  — заводит FetchRun со статусом RUNNING и сразу отдаёт его id;
 *   runJob     — крутит выгрузку, сохраняя каждую страницу и двигая прогресс;
 *   jobProgress — отвечает на опрос из интерфейса.
 *
 * Состояние живёт в БД, а не в памяти процесса: перезагрузка страницы,
 * вторая вкладка и повторный опрос видят одну и ту же картину.
 */

import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { assertTransition, outcomeFor, type FetchStatus, type JobProgress } from "@/lib/job-status";
import { YouTubeApiError } from "@/lib/youtube/api";
import { resolveChannel } from "@/lib/youtube/resolve-channel";
import type { ConfirmOptions } from "@/lib/youtube/shorts-check";
import { computeVirality, type ViralityInput } from "@/lib/virality";
import {
  streamChannelVideos,
  type FetchLimit,
  type FetchSelection,
  type FetchedVideo,
} from "@/lib/youtube/videos";

export type StartFailure =
  | { readonly kind: "invalid-url"; readonly detail: "empty" | "foreign-host" | "unrecognized" }
  | { readonly kind: "no-types" }
  | { readonly kind: "not-found" }
  | { readonly kind: "api"; readonly reason: string };

export type StartResult =
  | { readonly ok: true; readonly runId: string; readonly channelId: string }
  | { readonly ok: false; readonly failure: StartFailure };

export interface JobOptions {
  readonly limit?: FetchLimit;
  readonly includeVideos?: boolean;
  readonly includeShorts?: boolean;
  readonly prisma?: PrismaClient;
  readonly shorts?: ConfirmOptions;
}

/**
 * Заводит задание: разрешает канал и создаёт FetchRun.
 *
 * Разрешение канала делается здесь, а не в фоне, чтобы «канал не найден»
 * и «это не адрес YouTube» пользователь увидел сразу, а не через опрос.
 * Это один дешёвый вызов API.
 */
export async function createRun(rawUrl: string, options: JobOptions = {}): Promise<StartResult> {
  const db = options.prisma ?? defaultPrisma;
  const includeVideos = options.includeVideos ?? true;
  const includeShorts = options.includeShorts ?? true;

  if (!includeVideos && !includeShorts) {
    return { ok: false, failure: { kind: "no-types" } };
  }

  let resolved;
  try {
    resolved = await resolveChannel(rawUrl);
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      return { ok: false, failure: { kind: "api", reason: e.kind } };
    }
    throw e;
  }

  if (!resolved.ok) {
    return resolved.failure.reason === "invalid-url"
      ? { ok: false, failure: { kind: "invalid-url", detail: resolved.failure.detail } }
      : { ok: false, failure: { kind: "not-found" } };
  }

  const channel = resolved.channel;
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
      status: "RUNNING",
      startedAt: now,
      requestedLimit: options.limit === undefined ? null : options.limit,
      includeVideos,
      includeShorts,
      processedCount: 0,
    },
  });

  return { ok: true, runId: run.id, channelId: channel.id };
}

/** Ошибка нарушения уникальности от Prisma. */
function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2002";
}

/**
 * Сохраняет одно видео: есть — обновить, нет — завести.
 *
 * upsert в SQLite не атомарен — Prisma сначала ищет строку, потом вставляет.
 * Две выгрузки одного канала, идущие разом, успевают обе не найти видео
 * и обе пытаются его вставить; проигравший падает на уникальности
 * первичного ключа. Дубля при этом не возникает — возникает отказ на ровном
 * месте, поэтому проигравший просто обновляет то, что вставил победитель.
 */
async function saveVideo(
  db: PrismaClient,
  channelId: string,
  video: FetchedVideo,
  now: Date,
): Promise<void> {
  // Неизменное всё же обновляем: автор может переименовать видео
  // или переписать описание. goneAt сбрасывается: видео вернулось.
  const update = {
    title: video.title,
    description: video.description,
    durationSec: video.durationSec,
    kind: video.kind,
    kindAssumed: video.kindAssumed,
    lastSeenAt: now,
    goneAt: null,
  };

  try {
    await db.video.upsert({
      where: { id: video.id },
      update,
      create: {
        id: video.id,
        channelId,
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
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    await db.video.update({ where: { id: video.id }, data: update });
  }
}

/**
 * Обошла ли выгрузка канал целиком.
 *
 * Только у полного обхода «видео не встретилось» значит «видео исчезло».
 * Выгрузка с ограничением по количеству останавливается на полпути, выгрузка
 * одного типа не смотрит на второй, а прерванная не дошла до конца — в этих
 * случаях невстреченное видео просто не запрашивали, и помечать его
 * исчезнувшим было бы враньём.
 */
export function isCompleteSweep(
  run: {
    readonly requestedLimit: number | null;
    readonly includeVideos: boolean;
    readonly includeShorts: boolean;
  },
  failure: string | null,
): boolean {
  return failure === null && run.requestedLimit === null && run.includeVideos && run.includeShorts;
}

/**
 * Помечает видео канала, которых в этой выгрузке не оказалось.
 *
 * Строка не удаляется: у неё есть прошлые снимки метрик, и стирать их значит
 * терять историю. Дата ставится один раз — та, когда пропажу заметили впервые;
 * уже помеченные не трогаются, иначе «исчезло» превратилось бы в «последний
 * раз не видели».
 *
 * Условие — отсутствие снимка в этой выгрузке, а не давность lastSeenAt:
 * так две идущие разом выгрузки одного канала не мешают друг другу.
 */
export async function markVanished(
  db: PrismaClient,
  runId: string,
  channelId: string,
): Promise<number> {
  const { count } = await db.video.updateMany({
    where: { channelId, goneAt: null, stats: { none: { fetchRunId: runId } } },
    data: { goneAt: new Date() },
  });
  return count;
}

/** Сохраняет порцию видео и двигает прогресс задания. */
async function persistBatch(
  db: PrismaClient,
  runId: string,
  channelId: string,
  videos: readonly FetchedVideo[],
  totalResults: number | null,
): Promise<void> {
  const now = new Date();

  for (const video of videos) {
    await saveVideo(db, channelId, video, now);
  }

  // Снимки метрик заведомо новые — выгрузка только что создана, значит
  // одна вставка вместо сотен.
  await db.videoStat.createMany({
    data: videos.map((video) => ({
      videoId: video.id,
      fetchRunId: runId,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
    })),
  });

  await db.fetchRun.update({
    where: { id: runId },
    data: {
      processedCount: { increment: videos.length },
      ...(totalResults === null ? {} : { expectedCount: totalResults }),
    },
  });
}

/**
 * Считает вирусность по всей выгрузке и сохраняет её в снимки.
 *
 * Один раз по завершении, а не при отрисовке страницы: значение зависит
 * от медиан по всей выгрузке, поэтому на отдельной строке его не вычислить,
 * а пересчитывать на каждую страницу таблицы — гонять всю выборку впустую.
 *
 * Считается и для прерванной выгрузки: медианы по собранному — всё ещё
 * осмысленная опора, а «н/д» во всей колонке пользы не несёт.
 */
export async function applyVirality(db: PrismaClient, runId: string): Promise<void> {
  const stats = await db.videoStat.findMany({
    where: { fetchRunId: runId },
    include: { video: { select: { kind: true } } },
  });

  if (stats.length === 0) return;

  const input: ViralityInput[] = stats.map((stat) => ({
    id: stat.id,
    kind: stat.video.kind,
    viewCount: stat.viewCount,
    likeCount: stat.likeCount,
    commentCount: stat.commentCount,
  }));

  const scores = computeVirality(input);

  for (const [statId, score] of scores) {
    if (score === null) continue;
    await db.videoStat.update({ where: { id: statId }, data: { viralityScore: score } });
  }
}

async function finish(
  db: PrismaClient,
  runId: string,
  status: FetchStatus,
  errorReason: string | null,
  vanishedCount: number,
): Promise<void> {
  const run = await db.fetchRun.findUniqueOrThrow({ where: { id: runId } });
  // Переход проверяется явно: молча перезаписать терминальный статус значило бы
  // потерять причину остановки.
  assertTransition(run.status as FetchStatus, status);

  await db.fetchRun.update({
    where: { id: runId },
    data: { status, finishedAt: new Date(), errorReason, vanishedCount },
  });
}

/**
 * Выполняет задание до конца.
 *
 * Ошибка API не бросается наружу: она записывается в задание причиной
 * остановки. Собранное до сбоя остаётся — частичный результат ценнее,
 * чем ошибка вместо него.
 */
export async function runJob(runId: string, options: JobOptions = {}): Promise<void> {
  const db = options.prisma ?? defaultPrisma;

  const run = await db.fetchRun.findUniqueOrThrow({
    where: { id: runId },
    include: { channel: true },
  });

  const selection: FetchSelection = {
    limit: run.requestedLimit,
    includeVideos: run.includeVideos,
    includeShorts: run.includeShorts,
  };

  let processed = 0;
  let failure: string | null = null;

  try {
    for await (const batch of streamChannelVideos(
      run.channel.uploadsPlaylistId,
      selection,
      options.shorts ?? {},
    )) {
      await persistBatch(db, runId, run.channelId, batch.videos, batch.totalResults);
      processed += batch.videos.length;
    }
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      failure = e.kind;
    } else {
      failure = "unknown";
      console.error("[выгрузка] непредвиденный сбой", e);
    }
  }

  // Вирусность считается по всей выгрузке, поэтому только теперь, когда
  // известны все строки и медианы по ним.
  if (processed > 0) {
    await applyVirality(db, runId);
  }

  // Исчезнувшие помечаются только после полного обхода: иначе «не встретилось»
  // спутали бы с «исчезло».
  const vanished = isCompleteSweep(run, failure) ? await markVanished(db, runId, run.channelId) : 0;

  await finish(db, runId, outcomeFor(processed, failure), failure, vanished);
}

/**
 * Запускает задание и сразу возвращает управление.
 *
 * Работа продолжается в этом же процессе: сервис локальный, отдельная очередь
 * ему ни к чему. Ошибки задания уже записаны в БД, поэтому здесь гасится
 * только непредвиденное, чтобы не уронить процесс необработанным отказом.
 */
export async function startJob(rawUrl: string, options: JobOptions = {}): Promise<StartResult> {
  const started = await createRun(rawUrl, options);
  if (!started.ok) return started;

  void runJob(started.runId, options).catch((e: unknown) => {
    console.error("[выгрузка] задание упало", e);
  });

  return started;
}

/** Текущее состояние задания — ответ на опрос из интерфейса. */
export async function jobProgress(
  runId: string,
  options: { prisma?: PrismaClient } = {},
): Promise<JobProgress | null> {
  const db = options.prisma ?? defaultPrisma;
  // Канал берётся тем же запросом: подпись «данные собраны тогда-то»
  // нужна над каждой таблицей, в том числе открытой из истории.
  const run = await db.fetchRun.findUnique({
    where: { id: runId },
    include: { channel: { select: { id: true, title: true } } },
  });
  if (run === null) return null;

  return {
    status: run.status as FetchStatus,
    processed: run.processedCount,
    expected: run.expectedCount,
    errorReason: run.errorReason,
    vanished: run.vanishedCount,
    channelId: run.channel.id,
    channelTitle: run.channel.title,
    fetchedAt: run.finishedAt,
  };
}
