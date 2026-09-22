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

export interface TablePagerProps {
  readonly spec: PageSpec;
  readonly pageCount: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: PageSize) => void;
  /** Кнопки справа в той же строке — например, «Скачать таблицу». */
  readonly action?: ReactNode;
}

const BUTTON =
  "rounded border border-black/20 px-3 py-1.5 text-sm font-medium " +
  "enabled:hover:bg-black/5 disabled:opacity-40 " +
  "dark:border-white/25 dark:enabled:hover:bg-white/10";

/**
 * Переключатель страниц.
 *
 * Кнопки и выпадающий список — обычные элементы формы, поэтому переключение
 * работает с клавиатуры само, без собственных обработчиков клавиш.
 */
export function TablePager({
  spec,
  pageCount,
  total,
  onPage,
  onPageSize,
  action,
}: TablePagerProps) {
  const { from, to } = rowRange(spec, total);

  // Одна страница — листать нечего; выбор размера тоже бессмысленен,
  // пока строк меньше самого мелкого размера.
  const showPager = pageCount > 1;
  const showSize = total > MIN_PAGE_SIZE;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
      <p id="row-count" className="tabular-nums opacity-80">
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
        <nav aria-label="Страницы таблицы" className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPage(spec.page - 1)}
            disabled={spec.page <= 1}
            className={BUTTON}
          >
            ← Назад
          </button>

          <span aria-live="polite" className="tabular-nums">
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
          <label htmlFor="pageSize">Строк на странице</label>
          <select
            id="pageSize"
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
