"use server";

import { videoRows } from "@/lib/fetch-channel";
import { jobProgress, startJob, type StartFailure } from "@/lib/fetch-job";
import { isRunning } from "@/lib/job-status";
import type { FetchLimit } from "@/lib/youtube/videos";
import { emptyFormState, type FormState, type PollResult } from "./form-state";

const MESSAGES: Record<string, string> = {
  empty: "Введите адрес канала",
  "foreign-host": "Это не адрес канала YouTube",
  unrecognized: "Адрес не похож на страницу канала",
  "not-found": "Канал не найден",
  "no-types": "Выберите хотя бы один тип: Video или Shorts",
  "quota-exceeded": "Суточная квота YouTube API исчерпана — попробуйте завтра",
  "bad-key": "Ключ YouTube API не принят: проверьте YOUTUBE_API_KEY",
  network: "YouTube API недоступен",
  unknown: "Не удалось выгрузить канал",
};

export async function failureMessage(reason: string): Promise<string> {
  return MESSAGES[reason] ?? MESSAGES["unknown"]!;
}

function messageFor(failure: StartFailure): string {
  switch (failure.kind) {
    case "invalid-url":
      return MESSAGES[failure.detail] ?? "Адрес не похож на страницу канала";
    case "api":
      return MESSAGES[failure.reason] ?? MESSAGES["unknown"]!;
    default:
      return MESSAGES[failure.kind] ?? MESSAGES["unknown"]!;
  }
}

/**
 * Количество из формы: галочка «все видео» перебивает поле с числом.
 * Разбор строгий — подробные сообщения об ошибках добавит задача про валидацию.
 */
function readLimit(formData: FormData): FetchLimit {
  if (formData.get("allVideos") !== null) return null;

  const parsed = Number(String(formData.get("count") ?? "").trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Заводит задание и сразу возвращает его id. Дожидаться выгрузки здесь нельзя:
 * канал на тысячи роликов занял бы минуты, а страница всё это время висела бы.
 */
export async function startFetch(_prev: FormState, formData: FormData): Promise<FormState> {
  const started = await startJob(String(formData.get("channelUrl") ?? ""), {
    limit: readLimit(formData),
    includeVideos: formData.get("includeVideos") !== null,
    includeShorts: formData.get("includeShorts") !== null,
  });

  if (!started.ok) {
    return { ...emptyFormState, error: messageFor(started.failure) };
  }

  return { error: null, runId: started.runId };
}

/**
 * Состояние задания. Строки отдаются, только когда выгрузка закончилась:
 * во время работы таблица всё равно неполная, а запрос к БД на каждый
 * опрос стоил бы дороже прогресса.
 */
export async function pollFetch(runId: string): Promise<PollResult> {
  const progress = await jobProgress(runId);
  if (progress === null) return { progress: null, rows: [] };

  return {
    progress,
    rows: isRunning(progress.status) ? [] : await videoRows(runId),
  };
}
