"use client";

import { isRunning, progressLabel, type JobProgress } from "@/lib/job-status";

/**
 * Счётчик выгрузки.
 *
 * Стоит рядом с настройками, а не под формой: это главное, за чем следят,
 * пока идёт выгрузка, и глазу незачем прыгать вниз страницы. Выделен
 * подложкой и рамкой — среди галочек обычный серый текст терялся.
 */
export function FetchProgress({ progress }: { progress: JobProgress }) {
  const running = isRunning(progress.status);
  const failed = progress.status === "FAILED";
  const partial = progress.status === "PARTIAL";

  const tone = running
    ? "border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-300"
    : failed
      ? "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300"
      : partial
        ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";

  return (
    <p
      id="fetch-progress"
      // Прогресс меняется сам по себе: aria-live даёт скринридеру
      // прочитать обновление, не уводя фокус.
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium tabular-nums ${tone}`}
    >
      {running && (
        <span
          aria-hidden="true"
          className="size-2 animate-pulse rounded-full bg-current opacity-80"
        />
      )}
      {progressLabel(progress)}
    </p>
  );
}
