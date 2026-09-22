/**
 * Колонки таблицы — один список на весь проект.
 *
 * Таблица на экране и выгрузка в Excel обязаны совпадать заголовками
 * и порядком. Держать два списка значит обречь их разъехаться при первой
 * же правке, поэтому и та и другая читают этот.
 *
 * Различие у них ровно одно, и оно описано здесь же, а не заведено вторым
 * списком: на экране название видео живёт под ссылкой, в одной ячейке с ней,
 * а в книге у него своя колонка — в Excel двухэтажной ячейки не сделать,
 * да и фильтровать по названию удобнее отдельной колонкой.
 */

import type { SortColumn } from "@/lib/sorting";

export type ColumnKey =
  | "url"
  | "title"
  | "kind"
  | "durationSec"
  | "viewCount"
  | "likeCount"
  | "commentCount"
  | "viralityScore"
  | "publishedAt"
  | "description";

/** Где колонка видна. */
export type ColumnPlace = "both" | "workbook";

/**
 * Как выровнено содержимое.
 *
 * Значения по центру, текст по левому краю: колонку из коротких чисел глаз
 * читает сверху вниз, и ровная ось посередине помогает; а описание и ссылка
 * читаются как текст, и рваный левый край сбивал бы с толку.
 */
export type ColumnAlign = "left" | "center";

export interface TableColumn {
  readonly key: ColumnKey;
  readonly label: string;
  /** Колонка сортировки или null, когда по ней не сортируют. */
  readonly sort: SortColumn | null;
  readonly align: ColumnAlign;
  readonly place: ColumnPlace;
}

/** Порядок колонок задан ТЗ; название вставлено сразу за ссылкой. */
export const COLUMNS: readonly TableColumn[] = [
  { key: "url", label: "URL", sort: null, align: "left", place: "both" },
  { key: "title", label: "Название", sort: null, align: "left", place: "workbook" },
  { key: "kind", label: "Тип", sort: "kind", align: "center", place: "both" },
  {
    key: "durationSec",
    label: "Длительность",
    sort: "durationSec",
    align: "center",
    place: "both",
  },
  { key: "viewCount", label: "Просмотры", sort: "viewCount", align: "center", place: "both" },
  { key: "likeCount", label: "Лайки", sort: "likeCount", align: "center", place: "both" },
  {
    key: "commentCount",
    label: "Комментарии",
    sort: "commentCount",
    align: "center",
    place: "both",
  },
  {
    key: "viralityScore",
    label: "Вирусность",
    sort: "viralityScore",
    align: "center",
    place: "both",
  },
  { key: "publishedAt", label: "Дата", sort: "publishedAt", align: "center", place: "both" },
  { key: "description", label: "Описание", sort: null, align: "left", place: "both" },
];

/** Колонки таблицы на экране: название там не отдельная колонка, а подпись. */
export const SCREEN_COLUMNS: readonly TableColumn[] = COLUMNS.filter(
  (column) => column.place === "both",
);

/** Колонки книги Excel — все, включая название. */
export const WORKBOOK_COLUMNS: readonly TableColumn[] = COLUMNS;

export const COLUMN_LABELS: readonly string[] = WORKBOOK_COLUMNS.map((c) => c.label);
