/**
 * Строка канала в истории.
 *
 * Тип и его оформление живут отдельно от чтения базы: правила чистые
 * и проверяются без неё, а клиентскому компоненту нужен только тип.
 */

import { formatDateTime } from "@/lib/format";

export interface ChannelSummary {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  /** Сколько Video и Shorts известно сейчас — исчезнувшие не в счёт. */
  readonly videoCount: number;
  readonly shortsCount: number;
  readonly lastFetchedAt: Date | null;
  /** Последняя выгрузка: её и открывают из истории. */
  readonly latestRunId: string | null;
  /** Сколько всего снимков накоплено — на них стоит сравнение дат. */
  readonly runCount: number;
}

/** Сколько видео известно у канала всего. */
export function totalVideos(summary: ChannelSummary): number {
  return summary.videoCount + summary.shortsCount;
}

/**
 * Счётчики по типам.
 *
 * Оба числа называются всегда, даже нулевые: «12 Video» без второго числа
 * оставляет вопрос, искали ли Shorts вообще.
 */
export function countsLine(summary: ChannelSummary): string {
  return `${summary.videoCount} Video · ${summary.shortsCount} Shorts`;
}

/** Когда канал выгружали в последний раз. */
export function fetchedLine(summary: ChannelSummary): string {
  return summary.lastFetchedAt === null
    ? "выгрузка не завершалась"
    : "выгружено " + formatDateTime(summary.lastFetchedAt);
}

/** Вся строка целиком — то, что видно под названием канала. */
export function summaryLine(summary: ChannelSummary): string {
  const parts = [countsLine(summary), fetchedLine(summary)];
  // Про число снимков упоминаем, только когда их больше одного: у канала
  // с единственной выгрузкой сравнивать нечего, и говорить не о чем.
  if (summary.runCount > 1) parts.push(`снимков: ${summary.runCount}`);
  return parts.join(" · ");
}

/** Что показать вместо списка, когда выгрузок ещё не было. */
export const EMPTY_HISTORY =
  "Выгрузок ещё не было. Вставьте адрес канала выше и нажмите «Начать» — " +
  "канал появится здесь, и открыть его снова можно будет без обращения к YouTube.";

/**
 * Подпись над таблицей.
 *
 * Таблица, открытая из истории, ничем не отличается на вид от только что
 * выгруженной — и легко принять вчерашние цифры за сегодняшние. Дата снимка
 * снимает этот вопрос.
 */
export function snapshotNote(channelTitle: string, fetchedAt: Date | null): string {
  const channel = `Канал «${channelTitle}»`;
  return fetchedAt === null ? channel : `${channel} · данные собраны ${formatDateTime(fetchedAt)}`;
}
