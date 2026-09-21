"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { VideoRow } from "@/lib/fetch-channel";
import { isRunning, progressLabel, type JobProgress } from "@/lib/job-status";
import { pollFetch, startFetch } from "./actions";
import { DEFAULTS, POLL_INTERVAL_MS, emptyFormState, type FormState } from "./form-state";
import { VideoTable } from "./video-table";

/**
 * Адрес страницы помнит идентификатор задания, поэтому перезагрузка во время
 * выгрузки её не теряет: опрос продолжится с того же места. Само задание
 * крутится на сервере и от закрытия вкладки не зависит.
 */
const RUN_PARAM = "run";

/**
 * Идентификатор задания из адреса страницы.
 *
 * Через useSyncExternalStore, а не через эффект с setState: адрес — внешнее
 * для React состояние, и читать его в эффекте значит вызывать лишний каскад
 * перерисовок. На сервере адреса нет, поэтому серверный снимок — null,
 * и расхождения при гидратации не возникает.
 */
function useRunIdFromUrl(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("popstate", onChange);
      return () => window.removeEventListener("popstate", onChange);
    },
    () => new URLSearchParams(window.location.search).get(RUN_PARAM),
    () => null,
  );
}

function rememberRunId(runId: string | null): void {
  const url = new URL(window.location.href);
  if (runId === null) url.searchParams.delete(RUN_PARAM);
  else url.searchParams.set(RUN_PARAM, runId);
  window.history.replaceState(null, "", url.toString());
}

export function ChannelForm() {
  const [state, action, submitting] = useActionState<FormState, FormData>(
    startFetch,
    emptyFormState,
  );

  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [rows, setRows] = useState<readonly VideoRow[]>([]);
  const [lost, setLost] = useState(false);

  // Задание берётся из ответа действия, а после перезагрузки — из адреса.
  // Это вычисляемое значение, а не состояние: дублировать его в useState
  // значило бы синхронизировать два источника правды.
  const urlRunId = useRunIdFromUrl();
  const runId = state.runId ?? urlRunId;

  // Галочка «все видео» гасит поле с числом: держать их спорящими незачем.
  const [allVideos, setAllVideos] = useState(DEFAULTS.allVideos);
  const [includeVideos, setIncludeVideos] = useState(DEFAULTS.includeVideos);
  const [includeShorts, setIncludeShorts] = useState(DEFAULTS.includeShorts);

  const noTypeChosen = !includeVideos && !includeShorts;
  const working = submitting || (progress !== null && isRunning(progress.status));

  useEffect(() => {
    if (runId === null) return;

    // Адрес страницы помнит задание, чтобы перезагрузка его не потеряла.
    // Это запись во внешнюю систему, а не состояние React.
    rememberRunId(runId);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Цикл опроса живёт внутри эффекта: так он сам себе доступен для
    // повторного вызова и гарантированно останавливается при размонтировании.
    const tick = async (): Promise<void> => {
      const result = await pollFetch(runId);
      if (cancelled) return;

      if (result.progress === null) {
        // Задания нет: адрес из прошлого запуска с другой базой.
        setLost(true);
        setProgress(null);
        rememberRunId(null);
        return;
      }

      setLost(false);
      setProgress(result.progress);
      setRows(result.rows);

      if (isRunning(result.progress.status)) {
        timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [runId]);

  const finished = progress !== null && !isRunning(progress.status);

  return (
    <>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="channelUrl" className="mb-1 block text-sm font-medium">
              Адрес канала
            </label>
            <input
              id="channelUrl"
              name="channelUrl"
              type="text"
              placeholder="https://www.youtube.com/@channel"
              // Сообщение об ошибке связано с полем программно, иначе скринридер
              // прочитает поле без причины отказа.
              aria-describedby={state.error === null ? undefined : "channelUrl-error"}
              aria-invalid={state.error !== null}
              className="w-full rounded border border-black/20 px-3 py-2 dark:border-white/25"
            />
          </div>

          <button
            type="submit"
            disabled={working || noTypeChosen}
            aria-describedby={noTypeChosen ? "types-hint" : undefined}
            className="rounded bg-red-600 px-5 py-2 font-medium text-white disabled:opacity-60"
          >
            {working ? "Выгружаю…" : "Начать"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <label htmlFor="count" className="font-medium">
              Количество
            </label>
            <input
              id="count"
              name="count"
              type="number"
              min={1}
              step={1}
              defaultValue={DEFAULTS.count}
              disabled={allVideos}
              className="w-24 rounded border border-black/20 px-2 py-1 disabled:opacity-50 dark:border-white/25"
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="allVideos"
              checked={allVideos}
              onChange={(e) => setAllVideos(e.target.checked)}
              className="size-4"
            />
            Все видео
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="includeVideos"
              checked={includeVideos}
              onChange={(e) => setIncludeVideos(e.target.checked)}
              className="size-4"
            />
            Video
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="includeShorts"
              checked={includeShorts}
              onChange={(e) => setIncludeShorts(e.target.checked)}
              className="size-4"
            />
            Shorts
          </label>
        </div>

        {noTypeChosen && (
          <p id="types-hint" className="text-sm text-amber-700 dark:text-amber-500">
            Выберите хотя бы один тип: Video или Shorts
          </p>
        )}
      </form>

      {state.error !== null && (
        <p id="channelUrl-error" role="alert" className="mt-2 text-sm text-red-600">
          {state.error}
        </p>
      )}

      {lost && (
        <p className="mt-3 text-sm opacity-70">
          Эта выгрузка не найдена — возможно, она из прошлого запуска. Начните заново.
        </p>
      )}

      {progress !== null && (
        <p
          id="fetch-progress"
          // Прогресс меняется сам по себе: aria-live даёт скринридеру
          // прочитать обновление, не уводя фокус.
          aria-live="polite"
          className="mt-3 text-sm tabular-nums opacity-80"
        >
          {progressLabel(progress)}
        </p>
      )}

      {finished && progress.errorReason !== null && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          Причина остановки: {progress.errorReason}
        </p>
      )}

      {finished && progress.processed > 0 && <VideoTable rows={rows} />}
    </>
  );
}
