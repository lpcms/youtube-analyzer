"use client";

import type { ReactNode } from "react";
import { formatCount } from "@/lib/format";
import {
  MIN_PAGE_SIZE,
  PAGE_SIZES,
  isPageSize,
  rowRange,
  type PageSize,
  type PageSpec,
} from "@/lib/pagination";

/**
 * Где стоит панель. Их две — над таблицей и под ней, чтобы листать и скачивать
 * можно было, не уезжая в другой конец длинной страницы.
 */
export type PagerPlace = "top" | "bottom";

export interface TablePagerProps {
  readonly spec: PageSpec;
  readonly pageCount: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: PageSize) => void;
  /** Кнопки справа в той же строке — например, «Скачать таблицу». */
  readonly action?: ReactNode;
  readonly place: PagerPlace;
}

const BUTTON =
  "rounded border border-black/20 px-3 py-1.5 text-sm font-medium " +
  "enabled:hover:bg-black/5 disabled:opacity-40 " +
  "dark:border-white/25 dark:enabled:hover:bg-white/10";

const PLACE_LABEL: Record<PagerPlace, string> = { top: "сверху", bottom: "снизу" };

/**
 * Переключатель страниц.
 *
 * Кнопки и выпадающий список — обычные элементы формы, поэтому переключение
 * работает с клавиатуры само, без собственных обработчиков клавиш.
 *
 * Панель выводится дважды, поэтому всё, что должно быть на странице
 * в единственном экземпляре, различается по `place`:
 *
 * - `id` у счётчика строк и у выбора размера: два одинаковых `id` — невалидная
 *   разметка, и связь `label` с полем перестаёт быть однозначной;
 * - имя у `nav`: в списке ориентиров скринридера две «Страницы таблицы»
 *   неразличимы, и непонятно, куда ведёт каждая;
 * - `aria-live` только у верхней: иначе смену страницы объявят дважды подряд.
 */
export function TablePager({
  spec,
  pageCount,
  total,
  onPage,
  onPageSize,
  action,
  place,
}: TablePagerProps) {
  const { from, to } = rowRange(spec, total);

  // Одна страница — листать нечего; выбор размера тоже бессмысленен,
  // пока строк меньше самого мелкого размера.
  const showPager = pageCount > 1;
  const showSize = total > MIN_PAGE_SIZE;

  const rowCountId = `row-count-${place}`;
  const sizeId = `pageSize-${place}`;

  return (
    <div
      data-place={place}
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 text-sm ${
        place === "top" ? "mt-3" : "mt-4"
      }`}
    >
      <p id={rowCountId} className="tabular-nums opacity-80">
        {total === 0 ? (
          "Нет строк"
        ) : (
          <>
            Строки{" "}
            <span className="font-medium">
              {formatCount(from)}–{formatCount(to)}
            </span>{" "}
            из <span className="font-medium">{formatCount(total)}</span>
          </>
        )}
      </p>

      {showPager && (
        <nav
          aria-label={`Страницы таблицы, ${PLACE_LABEL[place]}`}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => onPage(spec.page - 1)}
            disabled={spec.page <= 1}
            className={BUTTON}
          >
            ← Назад
          </button>

          <span aria-live={place === "top" ? "polite" : "off"} className="tabular-nums">
            Страница <span className="font-medium">{spec.page}</span> из{" "}
            <span className="font-medium">{pageCount}</span>
          </span>

          <button
            type="button"
            onClick={() => onPage(spec.page + 1)}
            disabled={spec.page >= pageCount}
            className={BUTTON}
          >
            Вперёд →
          </button>
        </nav>
      )}

      {showSize && (
        <div className="flex items-center gap-2">
          <label htmlFor={sizeId}>Строк на странице</label>
          <select
            id={sizeId}
            value={spec.pageSize}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (isPageSize(next)) onPageSize(next);
            }}
            className="rounded border border-black/20 px-2 py-1 dark:border-white/25"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      )}

      {action !== undefined && <div className="ml-auto">{action}</div>}
    </div>
  );
}
