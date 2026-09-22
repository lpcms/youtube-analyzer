/**
 * Девять колонок таблицы — один список на весь проект.
 *
 * Таблица на экране и выгрузка в Excel обязаны совпадать заголовками
 * и порядком. Держать два списка значит обречь их разъехаться при первой
 * же правке, поэтому и та и другая читают этот.
 */

import type { SortColumn } from "@/lib/sorting";

export type ColumnKey =
  | "url"
  | "kind"
  | "durationSec"
  | "viewCount"
  | "likeCount"
  | "commentCount"
  | "viralityScore"
  | "publishedAt"
  | "description";

export interface TableColumn {
  readonly key: ColumnKey;
  readonly label: string;
  /** Колонка сортировки или null, когда по ней не сортируют. */
  readonly sort: SortColumn | null;
  /** Числовая — значит выравнивается вправо. */
  readonly numeric: boolean;
}

/** Порядок колонок задан ТЗ. */
export const COLUMNS: readonly TableColumn[] = [
  { key: "url", label: "URL", sort: null, numeric: false },
  { key: "kind", label: "Тип", sort: "kind", numeric: false },
  { key: "durationSec", label: "Длительность", sort: "durationSec", numeric: true },
  { key: "viewCount", label: "Просмотры", sort: "viewCount", numeric: true },
  { key: "likeCount", label: "Лайки", sort: "likeCount", numeric: true },
  { key: "commentCount", label: "Комментарии", sort: "commentCount", numeric: true },
  { key: "viralityScore", label: "Вирусность", sort: "viralityScore", numeric: true },
  { key: "publishedAt", label: "Дата", sort: "publishedAt", numeric: false },
  { key: "description", label: "Описание", sort: null, numeric: false },
];

export const COLUMN_LABELS: readonly string[] = COLUMNS.map((c) => c.label);
