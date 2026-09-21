/**
 * Разбивка таблицы на страницы.
 *
 * Страница берётся из базы запросом с limit и offset, а не отрезается от уже
 * полученного массива: выгрузка канала может быть в десятки тысяч строк,
 * и тащить их все в браузер ради полусотни видимых бессмысленно.
 */

/** Размеры страницы на выбор. Первый — не умолчание, а самый мелкий. */
export const PAGE_SIZES = [25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

/** Полсотни строк — примерно экран с прокруткой, и не больше. */
export const DEFAULT_PAGE_SIZE: PageSize = 50;

export const MIN_PAGE_SIZE: PageSize = PAGE_SIZES[0];

export interface PageSpec {
  /** Номер страницы, считая с единицы: так он и показывается пользователю. */
  readonly page: number;
  /**
   * Размер страницы обычным числом: арифметика работает с любым.
   * Ограничение списком `PAGE_SIZES` стоит на границе с клиентом —
   * в `parsePage` и в выпадающем списке, — чтобы запросом нельзя было
   * попросить миллион строк разом.
   */
  readonly pageSize: number;
}

export const FIRST_PAGE: PageSpec = { page: 1, pageSize: DEFAULT_PAGE_SIZE };

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

/**
 * Сколько всего страниц.
 *
 * Пустая выгрузка — одна страница, а не ноль: «страница 1 из 0» звучит
 * бессмысленно, а показывать нечего в обоих случаях.
 */
export function pageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/** Загоняет номер страницы в существующие границы. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), last);
}

/** Сколько строк пропустить, чтобы попасть на нужную страницу. */
export function offsetFor(spec: PageSpec): number {
  return (Math.max(1, spec.page) - 1) * spec.pageSize;
}

/**
 * Разбирает страницу из ненадёжного источника — запроса клиента.
 * Непонятное молча заменяется умолчанием: это оформление таблицы,
 * а не данные, и ронять запрос из-за него незачем.
 */
export function parsePage(page: unknown, pageSize: unknown): PageSpec {
  const parsedSize = Number(pageSize);
  const size: PageSize = isPageSize(parsedSize) ? parsedSize : DEFAULT_PAGE_SIZE;

  const parsedPage = Number(page);
  const number = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { page: number, pageSize: size };
}

/**
 * Новая страница после смены размера.
 *
 * Держимся за первую строку, которая была видна: иначе при переходе
 * с сотни на двадцать пять пользователь улетал бы в начало таблицы,
 * потеряв место, на котором остановился.
 */
export function pageAfterResize(current: PageSpec, nextSize: PageSize, total: number): number {
  const firstVisibleRow = offsetFor(current);
  const target = Math.floor(firstVisibleRow / nextSize) + 1;
  return clampPage(target, total, nextSize);
}

/** Номера строк, попавших на страницу, — для подписи «21–40 из 137». */
export function rowRange(spec: PageSpec, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };

  const from = offsetFor(spec) + 1;
  const to = Math.min(total, offsetFor(spec) + spec.pageSize);
  return { from, to };
}
