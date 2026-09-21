"use server";

import { fetchChannel, videoRows, type FetchChannelError } from "@/lib/fetch-channel";
import { emptyFormState, type FormState } from "./form-state";

const MESSAGES: Record<string, string> = {
  empty: "Введите адрес канала",
  "foreign-host": "Это не адрес канала YouTube",
  unrecognized: "Адрес не похож на страницу канала",
  "not-found": "Канал не найден",
  "quota-exceeded": "Суточная квота YouTube API исчерпана — попробуйте завтра",
  "bad-key": "Ключ YouTube API не принят: проверьте YOUTUBE_API_KEY",
  network: "YouTube API недоступен",
};

function messageFor(error: FetchChannelError): string {
  switch (error.kind) {
    case "invalid-url":
      return MESSAGES[error.detail] ?? "Адрес не похож на страницу канала";
    case "not-found":
      return "Канал не найден";
    case "api":
      return MESSAGES[error.reason] ?? "Не удалось выгрузить канал";
  }
}

export async function startFetch(_prev: FormState, formData: FormData): Promise<FormState> {
  const url = String(formData.get("channelUrl") ?? "");
  const result = await fetchChannel(url);

  if (!result.ok) {
    return { ...emptyFormState, error: messageFor(result.error) };
  }

  return {
    error: null,
    channelId: result.channelId,
    rows: await videoRows(result.fetchRunId),
  };
}
