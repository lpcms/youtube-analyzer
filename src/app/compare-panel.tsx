"use client";

import { useState } from "react";
import type { Comparison, RunOption } from "@/lib/compare-runs";
import {
  NOTHING_TO_COMPARE,
  PARTIAL_WARNING,
  countsLine,
  formatDelta,
  formatRatio,
  presenceLabel,
  type ComparisonRow,
  type Delta,
  type Metric,
} from "@/lib/comparison";
import { formatCount, formatDateTime } from "@/lib/format";
import { DEFAULT_PAGE_SIZE, rowRange } from "@/lib/pagination";
import { videoUrl } from "@/lib/youtube/video-url";
import { fetchComparison } from "./actions";

/**
 * Сравнение двух выгрузок канала.
 *
 * Стоит под таблицей, а не вместо неё: снимок остаётся главным, а разница —
 * отдельный взгляд на те же видео. Ни одного обращения к YouTube: оба снимка
 * уже в SQLite, и прошлых цифр у API всё равно нет.
 *
 * Считается по кнопке, а не сразу: сведение двух снимков читает их целиком,
 * и платить этим за каждое открытие канала незачем — сравнение смотрят реже,
 * чем саму таблицу.
 */

/** `2026-09-21 14:21 · 137 видео` — по чему выбирают снимок. */
export function runLabel(run: RunOption): string {
  const parts = [formatDateTime(run.startedAt), `${run.rowCount} видео`];
  // Неполный обход называется прямо в списке: от него зависит смысл пометок
  // «новое» и «исчезло», и узнавать об этом уже из таблицы поздно.
  if (!run.complete) parts.push("неполная");
  return parts.join(" · ");
}

const CELL = "px-3 py-2.5 align-top";
const NUMERIC = `${CELL} text-right tabular-nums`;

const KIND_LABEL = { VIDEO: "Video", SHORTS: "Shorts" } as const;

/**
 * Ячейка метрики: значение сверху, прирост под ним.
 *
 * Значение — из позднего снимка, а у исчезнувшего видео из раннего: это
 * последнее, что о нём известно, и прочерк вместо цифр терял бы его метрики
 * вовсе.
 */
function MetricCell({ delta, shown }: { delta: Delta; shown: Metric }) {
  const ratio = formatRatio(delta);
  const grew = delta.kind === "value" && delta.absolute > 0;
  const fell = delta.kind === "value" && delta.absolute < 0;

  return (
    <td className={NUMERIC}>
      <div>{formatCount(shown)}</div>
      <div
        className={`text-xs ${
          grew
            ? "text-emerald-700 dark:text-emerald-400"
            : fell
              ? "text-red-700 dark:text-red-400"
              : "opacity-50"
        }`}
      >
        {formatDelta(delta)}
        {ratio !== null && <span className="ml-1 opacity-70">({ratio})</span>}
      </div>
    </td>
  );
}

function PresenceBadge({ row }: { row: ComparisonRow }) {
  const label = presenceLabel(row.presence);
  if (label === null) return null;

  return (
    <span
      className={`ml-2 rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${
        row.presence === "new"
          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
          : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
      }`}
    >
      {label}
    </span>
  );
}

/** Значение, которое видно в строке: позднее, а у исчезнувшего — раннее. */
function shownMetrics(row: ComparisonRow): {
  views: Metric;
  likes: Metric;
  comments: Metric;
} {
  const source = row.after ?? row.before;
  if (source === null) return { views: null, likes: null, comments: null };
  return {
    views: source.viewCount,
    likes: source.likeCount,
    comments: source.commentCount,
  };
}

function ComparisonTable({ rows }: { rows: readonly ComparisonRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
      <table className="w-full min-w-[900px] border-collapse text-sm leading-snug">
        <caption className="sr-only">Прирост метрик между двумя выгрузками</caption>
        <thead>
          <tr className="bg-black/[0.04] text-left dark:bg-white/[0.06]">
            {["URL", "Тип", "Просмотры", "Лайки", "Комментарии", "Дата"].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`border-b border-black/10 px-3 py-2.5 font-semibold whitespace-nowrap dark:border-white/15 ${
                  index >= 2 && index <= 4 ? "text-right" : ""
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shown = shownMetrics(row);
            return (
              <tr
                key={row.id}
                className="border-b border-black/8 last:border-0 odd:bg-black/[0.015] hover:bg-amber-500/8 dark:border-white/10 dark:odd:bg-white/[0.03]"
              >
                <th scope="row" className={`${CELL} max-w-xs font-normal`}>
                  <a
                    href={videoUrl(row.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-blue-700 underline underline-offset-2 dark:text-blue-400"
                  >
                    {videoUrl(row.id)}
                  </a>
                  <span className="mt-0.5 block truncate text-xs opacity-60" title={row.title}>
                    {row.title}
                    <PresenceBadge row={row} />
                  </span>
                </th>
                <td className={`${CELL} whitespace-nowrap`}>{KIND_LABEL[row.kind]}</td>
                <MetricCell delta={row.views} shown={shown.views} />
                <MetricCell delta={row.likes} shown={shown.likes} />
                <MetricCell delta={row.comments} shown={shown.comments} />
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                  {formatDateTime(row.publishedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface ComparePanelProps {
  /** Выгрузки открытого канала, свежие сверху. */
  readonly runs: readonly RunOption[];
}

export function ComparePanel({ runs }: ComparePanelProps) {
  // Умолчание — две последние выгрузки: именно их и сравнивают чаще всего.
  const [laterId, setLaterId] = useState<string>(runs[0]?.id ?? "");
  const [earlierId, setEarlierId] = useState<string>(runs[1]?.id ?? "");

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load(page: number): void {
    if (earlierId === "" || laterId === "") return;

    setBusy(true);
    void fetchComparison(earlierId, laterId, page, DEFAULT_PAGE_SIZE)
      .then((result) => {
        if (result.ok) {
          setComparison(result.comparison);
          setError(null);
          return;
        }
        setComparison(null);
        setError(
          result.reason === "same-run"
            ? "Выберите две разные выгрузки: снимок сам с собой не сравнить."
            : "Эти выгрузки сравнить не удалось — возможно, канал уже удалён из истории.",
        );
      })
      .finally(() => setBusy(false));
  }

  if (runs.length < 2) {
    return (
      <section id="compare" className="mt-8">
        <h2 className="mb-2 text-lg font-semibold">Сравнение выгрузок</h2>
        <p className="max-w-2xl text-sm opacity-70">{NOTHING_TO_COMPARE}</p>
      </section>
    );
  }

  const range =
    comparison === null
      ? null
      : rowRange({ page: comparison.page, pageSize: DEFAULT_PAGE_SIZE }, comparison.total);

  return (
    <section id="compare" className="mt-8">
      <h2 className="mb-2 text-lg font-semibold">Сравнение выгрузок</h2>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="compare-earlier" className="font-medium">
            Ранняя выгрузка
          </label>
          <select
            id="compare-earlier"
            value={earlierId}
            onChange={(e) => setEarlierId(e.target.value)}
            className="rounded border border-black/20 px-2 py-1 dark:border-white/25"
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="compare-later" className="font-medium">
            Поздняя выгрузка
          </label>
          <select
            id="compare-later"
            value={laterId}
            onChange={(e) => setLaterId(e.target.value)}
            className="rounded border border-black/20 px-2 py-1 dark:border-white/25"
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => load(1)}
          disabled={busy}
          className="rounded border border-black/20 px-4 py-1.5 font-medium disabled:opacity-60 dark:border-white/25"
        >
          {busy ? "Считаю…" : "Сравнить"}
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {comparison !== null && (
        <>
          {/* Порядок дат в подписи — всегда от раннего к позднему, какую бы
              из них ни выбрали первой: знак прироста не должен зависеть
              от того, в какой список ткнули. */}
          <p id="compare-summary" className="mt-4 text-sm opacity-70">
            {formatDateTime(comparison.before.startedAt)} →{" "}
            {formatDateTime(comparison.after.startedAt)} · {countsLine(comparison.counts)}
          </p>

          {comparison.partial && (
            <p className="mt-1 max-w-3xl text-sm text-amber-700 dark:text-amber-500">
              {PARTIAL_WARNING}
            </p>
          )}

          <ComparisonTable rows={comparison.rows} />

          {comparison.pageCount > 1 && range !== null && (
            <div className="mt-2 flex items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => load(comparison.page - 1)}
                disabled={busy || comparison.page <= 1}
                className="rounded border border-black/20 px-3 py-1 disabled:opacity-40 dark:border-white/25"
              >
                Назад
              </button>
              <span id="compare-range" className="tabular-nums opacity-70">
                {range.from}–{range.to} из {comparison.total}
              </span>
              <button
                type="button"
                onClick={() => load(comparison.page + 1)}
                disabled={busy || comparison.page >= comparison.pageCount}
                className="rounded border border-black/20 px-3 py-1 disabled:opacity-40 dark:border-white/25"
              >
                Вперёд
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
