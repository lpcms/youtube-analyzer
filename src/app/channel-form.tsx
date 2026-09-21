"use client";

import { useActionState } from "react";
import { startFetch } from "./actions";
import { emptyFormState, type FormState } from "./form-state";
import { VideoTable } from "./video-table";

export function ChannelForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(startFetch, emptyFormState);

  return (
    <>
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
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
          disabled={pending}
          className="rounded bg-red-600 px-5 py-2 font-medium text-white disabled:opacity-60 sm:mt-6"
        >
          {pending ? "Выгружаю…" : "Начать"}
        </button>
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
