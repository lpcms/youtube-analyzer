"use client";

import { useActionState, useState } from "react";
import { startFetch } from "./actions";
import { DEFAULTS, emptyFormState, type FormState } from "./form-state";
import { VideoTable } from "./video-table";

export function ChannelForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(startFetch, emptyFormState);

  // Галочка «все видео» гасит поле с числом: держать их спорящими незачем.
  const [allVideos, setAllVideos] = useState(DEFAULTS.allVideos);
  const [includeVideos, setIncludeVideos] = useState(DEFAULTS.includeVideos);
  const [includeShorts, setIncludeShorts] = useState(DEFAULTS.includeShorts);

  const noTypeChosen = !includeVideos && !includeShorts;

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
            disabled={pending || noTypeChosen}
            aria-describedby={noTypeChosen ? "types-hint" : undefined}
            className="rounded bg-red-600 px-5 py-2 font-medium text-white disabled:opacity-60"
          >
            {pending ? "Выгружаю…" : "Начать"}
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

      {state.channelId !== null && <VideoTable rows={state.rows} />}
    </>
  );
}
