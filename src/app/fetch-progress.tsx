"use client";

import { isRunning, progressLabel, type JobProgress } from "@/lib/job-status";

/**
 * Счётчик выгрузки.
 *
 * Стоит в строке формы, рядом с настройками: это главное, за чем следят,
 * пока идёт выгрузка, и глазу незачем прыгать вниз страницы.
 *
 * Цвета нарочно не совпадают с плашкой состояния сервиса. Та живёт светофором:
 * зелёный — работает, жёлтый — предупреждение, красный — нет. Если бы и счётчик
 * по завершении зеленел, две соседние плашки стали бы неразличимы, хотя
 * говорят о разном: одна про сервис вообще, другая про конкретную выгрузку.
 * Поэтому у работы свой цвет — индиго, — а жёлтый и красный остаются за бедой.
 */
export function FetchProgress({ progress }: { progress: JobProgress }) {
  const running = isRunning(progress.status);
  const failed = progress.status === "FAILED";
  const partial = progress.status === "PARTIAL";

  const tone = failed
    ? "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300"
    : partial
      ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
      : "border-indigo-500/40 bg-indigo-500/10 text-indigo-800 dark:text-indigo-300";

  return (
    <p
      id="fetch-progress"
      // Прогресс меняется сам по себе: aria-live даёт скринридеру
      // прочитать обновление, не уводя фокус.
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium tabular-nums ${tone}`}
    >
      {/* Крутится, только пока идёт выгрузка: остановившийся волчок
          рядом с «Готово» означал бы, что что-то ещё происходит. */}
      {running && <Spinner />}
      {progressLabel(progress)}
    </p>
  );
}

/** Кольцо с прорезью: разрыв и создаёт ощущение вращения. */
function Spinner() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0 animate-spin">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
