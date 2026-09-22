"use client";

import type { SortSpec } from "@/lib/sorting";

/**
 * «Скачать таблицу».
 *
 * Это ссылка, а не кнопка с обработчиком: скачивание умеет сам браузер,
 * а файл собирает сервер. Значит, ни библиотеки, ни строк выгрузки
 * в странице не появляется — даже когда строк десятки тысяч.
 */
export interface ExportButtonProps {
  readonly runId: string;
  readonly sort: SortSpec;
  /** Нечего скачивать — нечего и предлагать. */
  readonly total: number;
}

export function ExportButton({ runId, sort, total }: ExportButtonProps) {
  if (total === 0) return null;

  const query = new URLSearchParams({
    run: runId,
    column: sort.column,
    direction: sort.direction,
  });

  return (
    <a
      // download без значения: имя файла приходит с сервера,
      // вместе с названием канала и датой выгрузки.
      download
      href={`/api/export?${query.toString()}`}
      className="rounded border border-black/20 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
    >
      <span aria-hidden="true">↓ </span>
      Скачать таблицу
    </a>
  );
}
