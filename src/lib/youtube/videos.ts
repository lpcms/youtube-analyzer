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

/**
 * Сколько видео выгружать: число либо `null` — «все».
 *
 * `null`, а не какое-нибудь большое число: «все» и «много» — разные намерения,
 * и в журнале выгрузки их надо различать.
 */
export type FetchLimit = number | null;

/** Что выгружать: сколько строк и каких типов. */
export interface FetchSelection {
  /** Число либо `null` — «все». */
  readonly limit: FetchLimit;
  readonly includeVideos: boolean;
  readonly includeShorts: boolean;
}

export interface UploadPage {
  readonly ids: readonly string[];
  readonly nextPageToken: string | undefined;
}

/**
 * Одна страница плейлиста загрузок — 1 единица квоты за 50 видео.
 *
 * Страницами, а не сразу целиком: тип видео становится известен только после
 * `videos.list`, поэтому отбор по типам идёт по мере обхода, и остановиться
 * можно, как только набрано нужное количество.
 */
export async function fetchUploadPage(
  uploadsPlaylistId: string,
  pageToken: string | undefined,
  maxResults: number,
): Promise<UploadPage> {
  const params: Record<string, string> = {
    part: "contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.max(1, Math.min(PAGE_SIZE, maxResults))),
  };
  if (pageToken !== undefined) params["pageToken"] = pageToken;

  const page = await callYouTube<PlaylistItemsResponse>("playlistItems.list", params);

  const ids: string[] = [];
  for (const item of page.items ?? []) {
    const id = item.contentDetails?.videoId;
    if (id !== undefined && id !== "") ids.push(id);
  }

  return { ids, nextPageToken: page.nextPageToken };
}

/**
 * Идентификаторы видео из плейлиста загрузок.
 *
 * Обход постраничный по `nextPageToken`. Отбора по типам здесь нет — он
 * невозможен до `videos.list`; этим занимается fetchChannelVideos.
 */
export async function fetchUploadIds(
  uploadsPlaylistId: string,
  limit: FetchLimit,
): Promise<readonly string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (limit === null || ids.length < limit) {
    const remaining = limit === null ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - ids.length);
    const page = await fetchUploadPage(uploadsPlaylistId, pageToken, remaining);

    ids.push(...page.ids);

    // Конец плейлиста. Пустая страница без токена тоже считается концом,
    // иначе обход зациклился бы на канале без видео.
    if (page.nextPageToken === undefined) break;
    pageToken = page.nextPageToken;
  }

  return limit === null ? ids : ids.slice(0, limit);
}

/**
 * Подходит ли видео под выбранные типы.
 *
 * Обе галочки сняты — не подходит ничего: это состояние формы, которое
 * не должно доходить до выгрузки, и молча выгружать всё было бы хуже.
 */
export function matchesSelection(
  video: Pick<FetchedVideo, "kind">,
  selection: Pick<FetchSelection, "includeVideos" | "includeShorts">,
): boolean {
  return video.kind === "SHORTS" ? selection.includeShorts : selection.includeVideos;
}

/**
 * Отбирает из списка не больше `limit` видео выбранных типов.
 *
 * Если подходящих меньше — возвращает все имеющиеся, а не добирает чужими.
 */
export function selectVideos(
  videos: readonly FetchedVideo[],
  selection: FetchSelection,
): readonly FetchedVideo[] {
  const matching = videos.filter((v) => matchesSelection(v, selection));
  return selection.limit === null ? matching : matching.slice(0, selection.limit);
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

/**
 * Видео канала выбранных типов, не больше заданного количества.
 *
 * Обход идёт страницами: для каждой страницы плейлиста запрашиваются метрики,
 * подтверждаются типы, отбираются подходящие. Как только набрано нужное
 * количество — обход прекращается, остаток канала не трогается вовсе.
 *
 * Иначе было нельзя: тип видео API не сообщает, он становится известен только
 * после `videos.list`, поэтому «первые N Shorts» не вычислить заранее.
 */
export async function fetchChannelVideos(
  uploadsPlaylistId: string,
  selection: FetchSelection,
  options: ConfirmOptions = {},
): Promise<readonly FetchedVideo[]> {
  const { limit, includeVideos, includeShorts } = selection;

  if (!includeVideos && !includeShorts) return [];

  const collected: FetchedVideo[] = [];
  let pageToken: string | undefined;

  while (limit === null || collected.length < limit) {
    // Когда выбраны оба типа, подходит каждая строка, и просить у API больше
    // остатка незачем. При отборе по типу сколько подойдёт — заранее неизвестно,
    // поэтому берём полную страницу.
    const bothTypes = includeVideos && includeShorts;
    const maxResults =
      limit !== null && bothTypes ? Math.min(PAGE_SIZE, limit - collected.length) : PAGE_SIZE;

    const page = await fetchUploadPage(uploadsPlaylistId, pageToken, maxResults);

    if (page.ids.length > 0) {
      const details = await fetchVideoDetails(page.ids);
      const resolved = await resolveKinds(details, options);
      collected.push(...resolved.filter((v) => matchesSelection(v, selection)));
    }

    if (page.nextPageToken === undefined) break;
    pageToken = page.nextPageToken;
  }

  return limit === null ? collected : collected.slice(0, limit);
}
