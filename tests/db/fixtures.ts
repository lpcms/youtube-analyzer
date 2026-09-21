import type { Channel, FetchRun, Video, VideoStat } from "@/generated/prisma/client";
import { testPrisma } from "./client";

/// Идентификаторы задаются настоящего формата, а не "id1": код отличает Shorts
/// от видео и разбирает ссылки по этим форматам, на заглушках такое не проверяется.
const CHANNEL_ID_BODY = "abcdefghijklmnopqrstuv"; // 22 символа после "UC"
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

let counter = 0;

function nextSuffix(): string {
  counter += 1;
  return String(counter);
}

/// Идентификатор канала: "UC" плюс 22 символа.
export function channelId(seed = nextSuffix()): string {
  return ("UC" + seed + CHANNEL_ID_BODY).slice(0, 24);
}

/// Идентификатор видео: ровно 11 символов из алфавита YouTube.
export function videoId(seed = nextSuffix()): string {
  const filler = ALPHABET.slice(0, 11);
  return (seed + filler).slice(0, 11);
}

export async function makeChannel(overrides: Partial<Channel> = {}): Promise<Channel> {
  const id = overrides.id ?? channelId();
  return testPrisma.channel.create({
    data: {
      id,
      title: "Тестовый канал",
      handle: "@test",
      thumbnailUrl: null,
      // Плейлист загрузок получается из id канала заменой "UC" на "UU".
      uploadsPlaylistId: "UU" + id.slice(2),
      lastFetchedAt: null,
      ...overrides,
    },
  });
}

type VideoInput = Partial<Video> & { channelId?: string };

async function createVideo(defaults: VideoInput, overrides: VideoInput): Promise<Video> {
  const merged = { ...defaults, ...overrides };
  const resolvedChannelId = merged.channelId ?? (await makeChannel()).id;

  return testPrisma.video.create({
    data: {
      id: merged.id ?? videoId(),
      channelId: resolvedChannelId,
      kind: merged.kind ?? "VIDEO",
      kindAssumed: merged.kindAssumed ?? false,
      durationSec: merged.durationSec ?? 0,
      // Даты только в UTC: смешивать локальное время нельзя, иначе видео уедет
      // в соседний день и тест начнёт зависеть от таймзоны машины.
      publishedAt: merged.publishedAt ?? new Date(Date.UTC(2026, 7, 1, 12, 30)),
      title: merged.title ?? "Тестовое видео",
      description: merged.description ?? "",
      lastSeenAt: merged.lastSeenAt ?? new Date(Date.UTC(2026, 8, 21, 14, 21)),
      goneAt: merged.goneAt ?? null,
      firstSeenAt: merged.firstSeenAt ?? new Date(Date.UTC(2026, 7, 1, 13, 0)),
    },
  });
}

/// Обычное видео: длиннее порога Shorts в 180 секунд.
export function makeVideo(overrides: VideoInput = {}): Promise<Video> {
  return createVideo({ kind: "VIDEO", durationSec: 725 }, overrides);
}

/// Shorts: короче порога в 180 секунд.
export function makeShort(overrides: VideoInput = {}): Promise<Video> {
  return createVideo({ kind: "SHORTS", durationSec: 45 }, overrides);
}

type FetchRunInput = Partial<FetchRun> & { channelId?: string };

export async function makeFetchRun(overrides: FetchRunInput = {}): Promise<FetchRun> {
  const resolvedChannelId = overrides.channelId ?? (await makeChannel()).id;

  return testPrisma.fetchRun.create({
    data: {
      channelId: resolvedChannelId,
      status: overrides.status ?? "SUCCEEDED",
      startedAt: overrides.startedAt ?? new Date(Date.UTC(2026, 8, 21, 14, 0)),
      finishedAt: overrides.finishedAt ?? new Date(Date.UTC(2026, 8, 21, 14, 21)),
      requestedLimit: overrides.requestedLimit ?? null,
      includeVideos: overrides.includeVideos ?? true,
      includeShorts: overrides.includeShorts ?? true,
      processedCount: overrides.processedCount ?? 0,
      expectedCount: overrides.expectedCount ?? null,
      snapshotPath: overrides.snapshotPath ?? null,
      errorReason: overrides.errorReason ?? null,
      ...(overrides.id === undefined ? {} : { id: overrides.id }),
    },
  });
}

type VideoStatInput = Partial<VideoStat> & { videoId?: string; fetchRunId?: string };

/// Снимок метрик. null в счётчике означает «статистика скрыта автором»,
/// а не ноль — фабрика позволяет задать такой случай явно.
export async function makeVideoStat(overrides: VideoStatInput = {}): Promise<VideoStat> {
  const resolvedVideoId = overrides.videoId ?? (await makeVideo()).id;
  const resolvedFetchRunId = overrides.fetchRunId ?? (await makeFetchRun()).id;

  return testPrisma.videoStat.create({
    data: {
      videoId: resolvedVideoId,
      fetchRunId: resolvedFetchRunId,
      viewCount: overrides.viewCount === undefined ? 10_000 : overrides.viewCount,
      likeCount: overrides.likeCount === undefined ? 500 : overrides.likeCount,
      commentCount: overrides.commentCount === undefined ? 40 : overrides.commentCount,
      viralityScore: overrides.viralityScore === undefined ? null : overrides.viralityScore,
      ...(overrides.id === undefined ? {} : { id: overrides.id }),
    },
  });
}
