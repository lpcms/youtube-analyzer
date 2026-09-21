/**
 * Вирусность видео.
 *
 * ТЗ задаёт входы, но не формулу. Абсолютная вовлечённость несравнима между
 * каналами и между типами: у Shorts она структурно другая, чем у длинных
 * видео. Поэтому оценка делается относительно медианы по выгрузке, **отдельно
 * для Video и отдельно для Shorts**:
 *
 *     ER         = (лайки + 2 × комментарии) / просмотры
 *     Вирусность = round(10 × (0,6 × ER / ER_медиана
 *                            + 0,4 × просмотры / просмотры_медиана), 1)
 *
 * Читается так: **10,0 — типичное видео своего типа на этом канале**, больше —
 * выше среднего. Комментарий весит вдвое против лайка: он требует заметно
 * большего усилия.
 *
 * Дизлайки в формулу не входят: YouTube убрал их в декабре 2021, API их
 * не отдаёт. Отступление от п.3 ТЗ зафиксировано в PRD.
 */

export type VideoKind = "VIDEO" | "SHORTS";

/** Вход расчёта: то, что известно о видео после выгрузки. */
export interface ViralityInput {
  readonly id: string;
  readonly kind: VideoKind;
  /** null означает «статистика скрыта автором», а не ноль. */
  readonly viewCount: number | null;
  readonly likeCount: number | null;
  readonly commentCount: number | null;
}

/** Верхняя граница: разовый всплеск не должен давать четырёхзначных чисел. */
export const MAX_SCORE = 100;

/** Вес вовлечённости и вес охвата. В сумме единица — оттого медиана и даёт 10. */
const ER_WEIGHT = 0.6;
const VIEWS_WEIGHT = 0.4;

/** Во сколько раз комментарий ценнее лайка. */
const COMMENT_WEIGHT = 2;

/**
 * Медиана. Для чётного количества — среднее двух средних значений.
 * Пустая выборка медианы не имеет.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? null;

  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

/**
 * Вовлечённость: `(лайки + 2 × комментарии) / просмотры`.
 *
 * null, если хоть один счётчик скрыт автором или просмотров ноль: делить
 * не на что, а подставить ноль вместо скрытого значения значило бы выдумать
 * факт. Такие видео не участвуют и в расчёте медианы.
 */
export function engagementRate(video: ViralityInput): number | null {
  const { viewCount, likeCount, commentCount } = video;

  if (viewCount === null || likeCount === null || commentCount === null) return null;
  if (viewCount <= 0) return null;

  return (likeCount + COMMENT_WEIGHT * commentCount) / viewCount;
}

/** Видео, у которого есть всё нужное для расчёта. */
export function isScorable(video: ViralityInput): boolean {
  return engagementRate(video) !== null;
}

/**
 * Отношение значения к медиане.
 *
 * Медиана может оказаться нулевой — например, когда у большинства видео
 * выгрузки нет ни лайков, ни комментариев. Делить на ноль нельзя, поэтому:
 * значение тоже ноль — отношение единица (видео ровно типичное), значение
 * больше нуля — оно бесконечно лучше медианы, и отношение упирается в потолок.
 */
function ratio(value: number, med: number): number {
  if (med > 0) return value / med;
  return value > 0 ? MAX_SCORE : 1;
}

/**
 * Считает вирусность для всей выгрузки.
 *
 * Возвращает значение по каждому видео: число либо null для тех, у кого
 * статистика скрыта или нет просмотров.
 */
export function computeVirality(videos: readonly ViralityInput[]): Map<string, number | null> {
  const result = new Map<string, number | null>();

  // Медианы считаются отдельно по типам: сравнивать вовлечённость Shorts
  // с вовлечённостью получасового видео бессмысленно.
  for (const kind of ["VIDEO", "SHORTS"] as const) {
    const ofKind = videos.filter((v) => v.kind === kind);
    const scorable = ofKind.filter(isScorable);

    for (const video of ofKind.filter((v) => !isScorable(v))) {
      result.set(video.id, null);
    }

    if (scorable.length === 0) continue;

    const erMedian = median(scorable.map((v) => engagementRate(v) ?? 0));
    const viewsMedian = median(scorable.map((v) => v.viewCount ?? 0));
    if (erMedian === null || viewsMedian === null) continue;

    for (const video of scorable) {
      const er = engagementRate(video) ?? 0;
      const views = video.viewCount ?? 0;

      const raw = 10 * (ER_WEIGHT * ratio(er, erMedian) + VIEWS_WEIGHT * ratio(views, viewsMedian));

      result.set(video.id, Math.round(Math.min(MAX_SCORE, raw) * 10) / 10);
    }
  }

  return result;
}
