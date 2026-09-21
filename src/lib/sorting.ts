/**
 * Сортировка таблицы.
 *
 * Порядок задаётся базе, а не считается в браузере: выгрузка канала может
 * быть в десятки тысяч строк, и сортировать такой массив на каждый клик
 * значит подвесить вкладку. К тому же пагинация (следующая задача) обязана
 * листать уже отсортированное целиком, а не переупорядочивать одну страницу.
 */

/** Колонки, по которым можно сортировать. URL и Описание в список не входят. */
export const SORT_COLUMNS = [
  "kind",
  "durationSec",
  "viewCount",
  "likeCount",
  "commentCount",
  "viralityScore",
  "publishedAt",
] as const;

export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = "asc" | "desc";

export interface SortSpec {
  readonly column: SortColumn;
  readonly direction: SortDirection;
}

/** По умолчанию — свежие сверху: так канал и читается. */
export const DEFAULT_SORT: SortSpec = { column: "publishedAt", direction: "desc" };

/** Часть полей живёт в снимке метрик, часть — в самом видео. */
const ON_VIDEO: ReadonlySet<SortColumn> = new Set<SortColumn>([
  "kind",
  "durationSec",
  "publishedAt",
]);

/** Только у этих колонок бывает «н/д» — скрытая автором статистика. */
const NULLABLE: ReadonlySet<SortColumn> = new Set<SortColumn>([
  "viewCount",
  "likeCount",
  "commentCount",
  "viralityScore",
]);

export function isSortColumn(value: string): value is SortColumn {
  return (SORT_COLUMNS as readonly string[]).includes(value);
}

export function isSortDirection(value: string): value is SortDirection {
  return value === "asc" || value === "desc";
}

/**
 * Разбирает сортировку из ненадёжного источника — запроса клиента.
 * Всё непонятное молча заменяется умолчанием: это оформление таблицы,
 * а не данные, и ронять запрос из-за него незачем.
 */
export function parseSort(column: string | null, direction: string | null): SortSpec {
  if (column === null || !isSortColumn(column)) return DEFAULT_SORT;
  if (direction === null || !isSortDirection(direction)) {
    return { column, direction: DEFAULT_SORT.direction };
  }
  return { column, direction };
}

/** Направление при первом клике по колонке. */
export function initialDirection(column: SortColumn): SortDirection {
  // Числа интереснее смотреть с наибольших, а тип и длительность — по порядку.
  return column === "kind" || column === "durationSec" ? "asc" : "desc";
}

/** Что произойдёт по клику: та же колонка переворачивается, другая начинает заново. */
export function nextSort(current: SortSpec, column: SortColumn): SortSpec {
  if (current.column !== column) {
    return { column, direction: initialDirection(column) };
  }
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** Значение `aria-sort` для заголовка: скринридер называет направление. */
export function ariaSort(
  current: SortSpec,
  column: SortColumn,
): "ascending" | "descending" | "none" {
  if (current.column !== column) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}

/** Стрелка в заголовке — то же самое, но для глаз. */
export function sortArrow(current: SortSpec, column: SortColumn): string {
  if (current.column !== column) return "";
  return current.direction === "asc" ? "↑" : "↓";
}

/** Поле и направление для Prisma, с учётом того, где живёт колонка. */
type PrismaOrder = Record<string, unknown>;

/**
 * Собирает `orderBy` для запроса снимков метрик.
 *
 * `nulls: "last"` для колонок со скрытой статистикой: строки с «н/д»
 * группируются в конце **при любом направлении**. Иначе при сортировке
 * по возрастанию они оказались бы сверху и оттеснили настоящие значения,
 * хотя ничего не сообщают.
 *
 * Вторым ключом — идентификатор видео: без него строки с одинаковым
 * значением меняли бы порядок между запросами, и пагинация показывала бы
 * одну строку дважды, а другую ни разу.
 */
export function orderByFor(sort: SortSpec): PrismaOrder[] {
  const { column, direction } = sort;

  const value: PrismaOrder = NULLABLE.has(column)
    ? { [column]: { sort: direction, nulls: "last" } }
    : { [column]: direction };

  const primary: PrismaOrder = ON_VIDEO.has(column) ? { video: value } : value;

  return [primary, { videoId: "asc" }];
}
