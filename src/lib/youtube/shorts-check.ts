/**
 * Подтверждение типа Shorts.
 *
 * YouTube Data API признака Shorts не отдаёт: Video и Shorts лежат в одном
 * плейлисте загрузок и выглядят одинаково. Длительность даёт только кандидата —
 * короткое обычное видео тоже укладывается в порог.
 *
 * Решает страница `youtube.com/shorts/<id>`:
 *
 * | Что за видео                  | Ответ | Вывод  |
 * | ----------------------------- | ----- | ------ |
 * | настоящий Short               | 200   | SHORTS |
 * | обычное, в том числе короткое | 303 → /watch | VIDEO |
 * | не существует или скрыто      | 404   | VIDEO  |
 *
 * Проверено на живых видео: Short на 40 секунд отвечает 200, «Me at the zoo»
 * (19 секунд, 2005 год — Shorts тогда не существовало) уходит редиректом.
 *
 * Запросы идут мимо API и **квоту не расходуют**, но это по запросу на каждого
 * кандидата, поэтому выполняются пакетно с ограничением одновременности.
 *
 * Эвристика держится на поведении, которое YouTube не обещает, — это главный
 * технический риск проекта. Недоступность проверки не должна ронять выгрузку:
 * тогда тип остаётся предположительным по длительности.
 */

import { shortsUrl } from "./video-url";

export type ShortsVerdict = "SHORTS" | "VIDEO" | "UNKNOWN";

/** Сколько проверок идёт одновременно: YouTube не стоит заваливать запросами. */
const DEFAULT_CONCURRENCY = 6;

export interface ConfirmOptions {
  readonly concurrency?: number;
  /** Подменяется в тестах; по умолчанию — глобальный fetch. */
  readonly fetchImpl?: typeof fetch;
}

async function checkOne(videoId: string, doFetch: typeof fetch): Promise<ShortsVerdict> {
  try {
    // HEAD вместо GET: нужен только статус, тело страницы Shorts весит сотни килобайт.
    const response = await doFetch(shortsUrl(videoId), {
      method: "HEAD",
      redirect: "manual",
    });
    return response.status === 200 ? "SHORTS" : "VIDEO";
  } catch {
    // Сеть не ответила — честнее не знать, чем угадать.
    return "UNKNOWN";
  }
}

/**
 * Проверяет кандидатов пакетами. Возвращает вердикт по каждому идентификатору;
 * `UNKNOWN` означает, что проверка не удалась и решать придётся по длительности.
 */
export async function confirmShorts(
  videoIds: readonly string[],
  options: ConfirmOptions = {},
): Promise<Map<string, ShortsVerdict>> {
  const doFetch = options.fetchImpl ?? fetch;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const verdicts = new Map<string, ShortsVerdict>();

  for (let i = 0; i < videoIds.length; i += concurrency) {
    const batch = videoIds.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((id) => checkOne(id, doFetch)));

    batch.forEach((id, index) => {
      verdicts.set(id, results[index] ?? "UNKNOWN");
    });
  }

  return verdicts;
}
