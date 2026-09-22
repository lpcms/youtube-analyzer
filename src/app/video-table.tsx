"use client";

import { useEffect, useRef } from "react";
import type { VideoRow } from "@/lib/fetch-channel";
import {
  descriptionPreview,
  formatCount,
  formatDateTime,
  formatDuration,
  formatVirality,
  isDescriptionTruncated,
} from "@/lib/format";
import { ariaSort, sortArrow, type SortColumn, type SortSpec } from "@/lib/sorting";
import { SCREEN_COLUMNS } from "@/lib/table-columns";
import { videoUrl } from "@/lib/youtube/video-url";
import { CopyButton } from "./copy-button";

const KIND_LABEL = { VIDEO: "Video", SHORTS: "Shorts" } as const;

/**
 * Вторая полоса прокрутки — над таблицей.
 *
 * Таблица из девяти колонок шире экрана, и чтобы прокрутить её вбок, иначе
 * пришлось бы уезжать в самый низ страницы за нижней полосой. Верхняя полоса
 * это пустой блок шириной с таблицу; обе полосы зеркалят друг друга.
 *
 * Ширина и прокрутка правятся прямо в DOM, без состояния React: это внешняя
 * система, и гонять через неё перерисовку на каждый пиксель прокрутки незачем.
 */
function useMirroredScroll(rowsKey: number) {
  const topRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const top = topRef.current;
    const spacer = spacerRef.current;
    const bottom = bottomRef.current;
    const table = tableRef.current;
    if (top === null || spacer === null || bottom === null || table === null) return;

    const syncWidth = (): void => {
      spacer.style.width = `${table.scrollWidth}px`;
    };
    syncWidth();

    const observer = new ResizeObserver(syncWidth);
    observer.observe(table);

    // Замок против эха: прокрутка одной полосы двигает вторую, та шлёт
    // своё событие обратно — без него они дёргались бы друг об друга.
    let syncing = false;
    const mirror = (from: HTMLDivElement, to: HTMLDivElement) => () => {
      if (syncing) return;
      syncing = true;
      to.scrollLeft = from.scrollLeft;
      syncing = false;
    };

    const onTop = mirror(top, bottom);
    const onBottom = mirror(bottom, top);
    top.addEventListener("scroll", onTop);
    bottom.addEventListener("scroll", onBottom);

    return () => {
      observer.disconnect();
      top.removeEventListener("scroll", onTop);
      bottom.removeEventListener("scroll", onBottom);
    };
  }, [rowsKey]);

  return { topRef, spacerRef, bottomRef, tableRef };
}

function KindCell({ row }: { row: VideoRow }) {
  const label = KIND_LABEL[row.kind];

  if (!row.kindAssumed) {
    return (
      <span
        className={
          row.kind === "SHORTS"
            ? "rounded bg-fuchsia-500/12 px-2 py-0.5 text-fuchsia-800 dark:text-fuchsia-300"
            : "rounded bg-sky-500/12 px-2 py-0.5 text-sky-800 dark:text-sky-300"
        }
      >
        {label}
      </span>
    );
  }

  // Подтвердить тип не удалось — он выведен из одной длительности.
  // Помечаем честно, вместо того чтобы выдавать догадку за факт.
  return (
    <span
      title="Тип определён по длительности: подтвердить через страницу Shorts не удалось"
      className="rounded border border-dotted border-current px-2 py-0.5 opacity-70"
    >
      {label}&nbsp;?
    </span>
  );
}

/**
 * Описание.
 *
 * Выводится как текст: React экранирует значение сам, поэтому разметка внутри
 * описания остаётся видимым текстом и не исполняется. Это важно — в описаниях
 * попадается произвольный HTML.
 *
 * Длинное сокращается, но полный текст доступен через details: он работает
 * с клавиатуры и без JavaScript, в отличие от всплывающей подсказки.
 */
function DescriptionCell({ text }: { text: string }) {
  if (text.trim() === "") {
    return <span className="opacity-40">—</span>;
  }

  if (!isDescriptionTruncated(text)) {
    return <span className="whitespace-pre-wrap opacity-80">{text.trim()}</span>;
  }

  return (
    <details className="group">
      <summary className="cursor-pointer list-none marker:content-none hover:underline">
        <span className="opacity-80 group-open:hidden">{descriptionPreview(text)}</span>
        <span className="hidden text-xs underline underline-offset-2 opacity-60 group-open:inline">
          свернуть
        </span>
      </summary>
      <span className="mt-1 block whitespace-pre-wrap opacity-80">{text.trim()}</span>
    </details>
  );
}

/**
 * Ячейки разделены вертикальной чертой.
 *
 * Девять колонок без разделителей сливаются в полосу текста, и взгляд теряет,
 * к какой колонке относится число. Черта светлая: её задача — вести глаз,
 * а не расчерчивать таблицу в клетку.
 */
const CELL = "border-r border-black/[0.07] px-3 py-2.5 last:border-r-0 dark:border-white/[0.09]";

/** Значение: по центру и моноширинными цифрами — колонка читается сверху вниз. */
const VALUE = `${CELL} text-center align-middle tabular-nums`;

/** Текст: по левому краю и от верха, иначе рваный край сбивает при чтении. */
const TEXT = `${CELL} align-top`;

export interface VideoTableProps {
  readonly rows: readonly VideoRow[];
  readonly sort: SortSpec;
  readonly onSort: (column: SortColumn) => void;
}

export function VideoTable({ rows, sort, onSort }: VideoTableProps) {
  const { topRef, spacerRef, bottomRef, tableRef } = useMirroredScroll(rows.length);

  if (rows.length === 0) {
    return <p className="mt-6 text-sm opacity-70">У этого канала нет видео.</p>;
  }

  return (
    <div className="mt-3">
      {/* Верхняя полоса прокрутки: пустая, но шириной с таблицу. */}
      <div ref={topRef} aria-hidden="true" className="overflow-x-auto overflow-y-hidden">
        <div ref={spacerRef} className="h-3" />
      </div>

      <div
        ref={bottomRef}
        className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15"
      >
        <table
          ref={tableRef}
          className="w-full min-w-[1180px] border-collapse text-sm leading-snug"
        >
          <caption className="sr-only">Видео канала с метриками</caption>
          <thead>
            <tr className="bg-black/[0.04] text-left dark:bg-white/[0.06]">
              {SCREEN_COLUMNS.map(({ label, sort: column, align }) => (
                <th
                  key={label}
                  scope="col"
                  // aria-sort сообщает направление скринридеру; у несортируемых
                  // колонок атрибута нет вовсе, иначе «none» звучал бы как
                  // «сортировка сброшена», хотя её и не предлагают.
                  aria-sort={column === null ? undefined : ariaSort(sort, column)}
                  className={`border-r border-b border-black/[0.07] border-b-black/15 px-3 py-2.5 font-semibold whitespace-nowrap last:border-r-0 dark:border-white/[0.09] dark:border-b-white/20 ${
                    align === "center" ? "text-center" : ""
                  }`}
                >
                  {column === null ? (
                    label
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSort(column)}
                      className="inline-flex cursor-pointer items-center gap-1 font-semibold underline-offset-4 hover:underline"
                    >
                      {label}
                      <span aria-hidden="true" className="w-3 text-xs">
                        {sortArrow(sort, column)}
                      </span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-black/8 last:border-0 odd:bg-black/[0.022] hover:bg-amber-500/10 dark:border-white/10 dark:odd:bg-white/[0.04]"
              >
                {/* Ссылка — опознавательная ячейка строки, поэтому th со scope="row". */}
                <th scope="row" className={`${TEXT} max-w-xs font-normal`}>
                  {/* Кнопка копирования у каждой строки: и ссылка, и название
                      обрезаны по ширине, мышью их целиком не выделить. */}
                  <div className="flex items-center gap-1">
                    <CopyButton
                      value={videoUrl(row.id)}
                      kind="link"
                      label="Скопировать ссылку на видео"
                    />
                    <a
                      href={videoUrl(row.id)}
                      target="_blank"
                      // noreferrer вместе с noopener: без них открытая вкладка
                      // получает доступ к window.opener.
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-blue-700 underline underline-offset-2 dark:text-blue-400"
                    >
                      {videoUrl(row.id)}
                    </a>
                  </div>
                  {/* Название под ссылкой: по одному идентификатору видео
                      не узнать, а открывать вкладку ради этого накладно. */}
                  <div className="mt-0.5 flex items-center gap-1">
                    <CopyButton value={row.title} kind="text" label="Скопировать название видео" />
                    <span className="min-w-0 flex-1 truncate text-xs opacity-60" title={row.title}>
                      {row.title}
                    </span>
                  </div>
                </th>
                <td className={`${VALUE} whitespace-nowrap`}>
                  <KindCell row={row} />
                </td>
                <td className={VALUE}>{formatDuration(row.durationSec)}</td>
                <td className={VALUE}>{formatCount(row.viewCount)}</td>
                <td className={VALUE}>{formatCount(row.likeCount)}</td>
                <td className={VALUE}>{formatCount(row.commentCount)}</td>
                <td className={`${VALUE} font-medium`}>{formatVirality(row.viralityScore)}</td>
                <td className={`${VALUE} whitespace-nowrap`}>{formatDateTime(row.publishedAt)}</td>
                <td className={`${TEXT} min-w-[22rem]`}>
                  <DescriptionCell text={row.description} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
