"use server";

import { fetchChannel, videoRows, type FetchChannelError } from "@/lib/fetch-channel";
import type { FetchLimit } from "@/lib/youtube/videos";
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

/**
 * Количество из формы: галочка «все видео» перебивает поле с числом.
 * Разбор строгий — подробные сообщения об ошибках добавит задача про валидацию.
 */
function readLimit(formData: FormData): FetchLimit {
  if (formData.get("allVideos") !== null) return null;

  const raw = String(formData.get("count") ?? "").trim();
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function startFetch(_prev: FormState, formData: FormData): Promise<FormState> {
  const url = String(formData.get("channelUrl") ?? "");
  const includeVideos = formData.get("includeVideos") !== null;
  const includeShorts = formData.get("includeShorts") !== null;

  if (!includeVideos && !includeShorts) {
    return { ...emptyFormState, error: "Выберите хотя бы один тип: Video или Shorts" };
  }

  const result = await fetchChannel(url, {
    limit: readLimit(formData),
    includeVideos,
    includeShorts,
  });

  if (!result.ok) {
    return { ...emptyFormState, error: messageFor(result.error) };
  }

  return {
    error: null,
    channelId: result.channelId,
    rows: await videoRows(result.fetchRunId),
  };
}
