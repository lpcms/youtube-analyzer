/**
 * Сравнение двух выгрузок канала.
 *
 * Ряд снимков копится ради динамики: без сравнения он мёртвый груз. Здесь —
 * чистые правила расчёта, без базы и без интерфейса, поэтому проверяются они
 * на голых числах.
 *
 * Главное различие, ради которого всё и написано: «прироста нет» бывает трёх
 * разных видов, и путать их нельзя.
 *
 *   value  — оба значения известны, прирост посчитан;
 *   hidden — метрика скрыта автором хотя бы в одном снимке, и «0» здесь
 *            был бы враньём: неизвестно даже, росла она или падала;
 *   absent — видео есть только в одном из снимков, и сравнивать не с чем.
 *            Показать «+12 345» у появившегося ролика значило бы выдать
 *            его первые же цифры за прирост от нуля.
 */

import { formatCount } from "@/lib/format";

/** Значение счётчика в снимке. null — статистика скрыта автором, а не ноль. */
export type Metric = number | null;

export type Delta =
  | {
      readonly kind: "value";
      readonly absolute: number;
      /** Доля от прежнего значения. null, когда прежнее — ноль: делить не на что. */
      readonly ratio: number | null;
    }
  | { readonly kind: "hidden" }
  | { readonly kind: "absent" };

export const ABSENT: Delta = { kind: "absent" };
export const HIDDEN: Delta = { kind: "hidden" };

/** Было ли видео в обоих снимках, появилось или исчезло. */
export type Presence = "both" | "new" | "gone";

/**
 * Прирост между двумя известными значениями.
 *
 * Скрытая метрика важнее нуля: если её не видно хоть в одном снимке,
 * прироста не существует, и выдавать за него разность нельзя.
 */
export function deltaOf(before: Metric, after: Metric): Delta {
  if (before === null || after === null) return HIDDEN;

  const absolute = after - before;
  return { kind: "value", absolute, ratio: before === 0 ? null : absolute / before };
}

/** Метрики одного видео в одном снимке. */
export interface Metrics {
  readonly viewCount: Metric;
  readonly likeCount: Metric;
  readonly commentCount: Metric;
}

/** Строка снимка: метрики видео плюс то неизменное, что нужно таблице. */
export interface SnapshotRow extends Metrics {
  readonly id: string;
  readonly title: string;
  readonly kind: "VIDEO" | "SHORTS";
  readonly kindAssumed: boolean;
  readonly publishedAt: Date;
}

export interface ComparisonRow {
  readonly id: string;
  readonly title: string;
  readonly kind: "VIDEO" | "SHORTS";
  readonly kindAssumed: boolean;
  readonly publishedAt: Date;
  readonly presence: Presence;
  /** Метрики раннего снимка; null — видео в нём не было. */
  readonly before: Metrics | null;
  /** Метрики позднего снимка; null — видео к нему исчезло. */
  readonly after: Metrics | null;
  readonly views: Delta;
  readonly likes: Delta;
  readonly comments: Delta;
}

/** Сколько видео сравнилось, сколько появилось, сколько исчезло. */
export interface ComparisonCounts {
  readonly compared: number;
  readonly added: number;
  readonly gone: number;
}

function metricsOf(row: SnapshotRow): Metrics {
  return { viewCount: row.viewCount, likeCount: row.likeCount, commentCount: row.commentCount };
}

function rowFrom(
  source: SnapshotRow,
  presence: Presence,
  before: Metrics | null,
  after: Metrics | null,
): ComparisonRow {
  const known = before !== null && after !== null;

  return {
    id: source.id,
    title: source.title,
    kind: source.kind,
    kindAssumed: source.kindAssumed,
    publishedAt: source.publishedAt,
    presence,
    before,
    after,
    views: known ? deltaOf(before.viewCount, after.viewCount) : ABSENT,
    likes: known ? deltaOf(before.likeCount, after.likeCount) : ABSENT,
    comments: known ? deltaOf(before.commentCount, after.commentCount) : ABSENT,
  };
}

/**
 * Сводит два снимка в одну таблицу.
 *
 * Объединение, а не пересечение: видео, исчезнувшее к позднему снимку,
 * обязано остаться в сравнении с пометкой. Выкинуть его значило бы показать
 * канал, на котором ничего не пропадало.
 *
 * Неизменное (название, тип, дата) берётся из позднего снимка, когда видео
 * есть в обоих: автор мог переименовать ролик, и свежее название вернее.
 *
 * Порядок — свежие сверху, тот же, что и у обычной таблицы: канал так
 * и читается, а сравнение не повод заводить своё правило.
 */
export function compareSnapshots(
  before: readonly SnapshotRow[],
  after: readonly SnapshotRow[],
): ComparisonRow[] {
  const earlier = new Map(before.map((row) => [row.id, row]));
  const later = new Map(after.map((row) => [row.id, row]));

  const rows: ComparisonRow[] = [];

  for (const row of after) {
    const previous = earlier.get(row.id);
    rows.push(
      previous === undefined
        ? rowFrom(row, "new", null, metricsOf(row))
        : rowFrom(row, "both", metricsOf(previous), metricsOf(row)),
    );
  }

  for (const row of before) {
    if (later.has(row.id)) continue;
    rows.push(rowFrom(row, "gone", metricsOf(row), null));
  }

  rows.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return rows;
}

export function countRows(rows: readonly ComparisonRow[]): ComparisonCounts {
  let compared = 0;
  let added = 0;
  let gone = 0;

  for (const row of rows) {
    if (row.presence === "both") compared += 1;
    else if (row.presence === "new") added += 1;
    else gone += 1;
  }

  return { compared, added, gone };
}

/** Знак у ненулевого прироста: минус приходит с самим числом, плюс — нет. */
function signed(value: number, text: string): string {
  return value > 0 ? "+" + text : text;
}

/**
 * Прирост числом: `+1 234`, `-56`, `0`.
 *
 * «н/д» — скрытая метрика, «—» — видео есть только в одном снимке.
 * Это разные вещи, и обозначены они по-разному нарочно.
 */
export function formatDelta(delta: Delta): string {
  if (delta.kind === "hidden") return "н/д";
  if (delta.kind === "absent") return "—";
  return signed(delta.absolute, formatCount(delta.absolute));
}

/**
 * Доля от прежнего значения: `+5,3 %`.
 *
 * null, когда доли не существует: прежнее значение было нулём, метрика
 * скрыта или сравнивать не с чем. Интерфейс тогда просто не пишет второй
 * строки — «+∞ %» и «0 %» одинаково сбивали бы с толку.
 */
export function formatRatio(delta: Delta): string | null {
  if (delta.kind !== "value" || delta.ratio === null) return null;

  // Округляем до десятых сразу, иначе -0,04 % превратилось бы в «-0,0 %»:
  // минус при нуле выглядит опечаткой.
  const percent = Number((delta.ratio * 100).toFixed(1));
  const text = Math.abs(percent).toFixed(1).replace(".", ",");

  if (percent === 0) return "0,0 %";
  return `${percent > 0 ? "+" : "-"}${text} %`;
}

/** Пометка строки: у появившихся и исчезнувших она есть, у остальных нет. */
export function presenceLabel(presence: Presence): string | null {
  if (presence === "new") return "новое";
  if (presence === "gone") return "исчезло";
  return null;
}

/** Что написать над таблицей сравнения. */
export function countsLine(counts: ComparisonCounts): string {
  const parts = [`сравнено: ${counts.compared}`];
  if (counts.added > 0) parts.push(`новых: ${counts.added}`);
  if (counts.gone > 0) parts.push(`исчезло: ${counts.gone}`);
  return parts.join(" · ");
}

/**
 * Оговорка про неполный снимок.
 *
 * У выгрузки с ограничением по количеству или прерванной на полпути
 * «видео не встретилось» не значит «видео появилось или исчезло»: его просто
 * не запрашивали. Та же причина, по которой `goneAt` ставится только после
 * полного обхода, — и умолчать о ней значило бы соврать пометками.
 */
export const PARTIAL_WARNING =
  "Одна из выгрузок обошла канал не целиком — с ограничением по количеству, " +
  "по одному типу или с остановкой на полпути. «Новое» и «исчезло» в таком " +
  "сравнении означают лишь то, что видео не запрашивали.";

/** Что показать, когда сравнивать ещё не с чем. */
export const NOTHING_TO_COMPARE =
  "Сравнивать пока не с чем: у канала одна выгрузка. Нажмите «Начать» ещё раз — " +
  "второй снимок встанет рядом с первым, и разницу будет видно по каждому видео.";
