/**
 * Выгрузка видео канала.
 *
 * Перебор идёт по плейлисту загрузок, а не через `search.list`: `playlistItems`
 * стоит 1 единицу квоты за 50 видео против 100 за один вызов поиска.
 */

import { callYouTube } from "./api";
import { SHORTS_MAX_SECONDS, parseIsoDuration } from "./duration";
import { confirmShorts, type ConfirmOptions } from "./shorts-check";

/** Максимум, который YouTube отдаёт за один вызов. */
export const PAGE_SIZE = 50;

export interface FetchedVideo {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly publishedAt: Date;
  readonly durationSec: number;
  readonly kind: "VIDEO" | "SHORTS";
  /**
   * true, когда тип выведен только из длительности: подтверждение через
   * страницу Shorts не удалось. Такие строки помечаются в таблице.
   */
  readonly kindAssumed: boolean;
  /** null означает «статистика скрыта автором», а не ноль. */
  readonly viewCount: number | null;
  readonly likeCount: number | null;
  readonly commentCount: number | null;
}

interface PlaylistItemsResponse {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
  nextPageToken?: string;
}

interface VideosResponse {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; description?: string; publishedAt?: string };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }>;
}

/**
 * Счётчик из ответа API. Отсутствующее поле — скрытая статистика, это null;
 * присутствующий ноль — настоящий ноль. Путать их нельзя: формула вирусности
 * обязана различать.
 */
function counter(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Кандидат в Shorts — по длительности. Порог включительный: ролик ровно
 * на 180 секунд ещё может быть Shorts.
 *
 * Обратное неверно: короткое обычное видео тоже укладывается в порог,
 * поэтому кандидат требует подтверждения.
 */
export function isShortsCandidate(durationSec: number): boolean {
  return durationSec <= SHORTS_MAX_SECONDS;
}

/**
 * Подтверждает тип кандидатов запросом к странице Shorts.
 *
 * Длинные видео не проверяются вовсе — лишние запросы ни к чему.
 * Неудавшаяся проверка оставляет тип предположительным, но выгрузку не роняет.
 */
export async function resolveKinds(
  videos: readonly FetchedVideo[],
  options: ConfirmOptions = {},
): Promise<readonly FetchedVideo[]> {
  const candidates = videos.filter((v) => isShortsCandidate(v.durationSec)).map((v) => v.id);
  if (candidates.length === 0) return videos;

  const verdicts = await confirmShorts(candidates, options);

  return videos.map((video) => {
    if (!isShortsCandidate(video.durationSec)) return video;

    const verdict = verdicts.get(video.id);
    if (verdict === undefined || verdict === "UNKNOWN") {
      // Остаётся предположение по длительности.
      return video;
    }
    return { ...video, kind: verdict, kindAssumed: false };
  });
}

/** Идентификаторы видео из плейлиста загрузок, не больше `limit`. */
export async function fetchUploadIds(
  uploadsPlaylistId: string,
  limit: number,
): Promise<readonly string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < limit) {
    const params: Record<string, string> = {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(PAGE_SIZE, limit - ids.length)),
    };
    if (pageToken !== undefined) params["pageToken"] = pageToken;

    const page = await callYouTube<PlaylistItemsResponse>("playlistItems.list", params);

    for (const item of page.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id !== undefined && id !== "") ids.push(id);
    }

    if (page.nextPageToken === undefined) break;
    pageToken = page.nextPageToken;
  }

  return ids.slice(0, limit);
}

/** Разбивает список на пакеты: `videos.list` принимает до 50 идентификаторов. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Метрики и длительность для перечисленных видео. */
export async function fetchVideoDetails(
  videoIds: readonly string[],
): Promise<readonly FetchedVideo[]> {
  const result: FetchedVideo[] = [];

  for (const batch of chunk(videoIds, PAGE_SIZE)) {
    const response = await callYouTube<VideosResponse>("videos.list", {
      part: "snippet,contentDetails,statistics",
      id: batch.join(","),
    });

    for (const item of response.items ?? []) {
      const id = item.id;
      const published = item.snippet?.publishedAt;
      if (id === undefined || published === undefined) continue;

      const durationSec = parseIsoDuration(item.contentDetails?.duration) ?? 0;

      result.push({
        id,
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
        publishedAt: new Date(published),
        durationSec,
        // Пока только по длительности — подтверждение ниже, в resolveKinds.
        kind: isShortsCandidate(durationSec) ? "SHORTS" : "VIDEO",
        kindAssumed: isShortsCandidate(durationSec),
        viewCount: counter(item.statistics?.viewCount),
        likeCount: counter(item.statistics?.likeCount),
        commentCount: counter(item.statistics?.commentCount),
      });
    }
  }

  return result;
}

/** Последние `limit` видео канала: идентификаторы из плейлиста, затем метрики. */
export async function fetchChannelVideos(
  uploadsPlaylistId: string,
  limit: number,
  options: ConfirmOptions = {},
): Promise<readonly FetchedVideo[]> {
  const ids = await fetchUploadIds(uploadsPlaylistId, limit);
  if (ids.length === 0) return [];
  const videos = await fetchVideoDetails(ids);
  return resolveKinds(videos, options);
}
