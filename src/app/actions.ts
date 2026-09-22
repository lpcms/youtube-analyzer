"use server";

import { failureMessage } from "@/lib/failure-message";
import { videoPage, type VideoPage } from "@/lib/fetch-channel";
import { jobProgress, startJob, type StartFailure } from "@/lib/fetch-job";
import { isRunning } from "@/lib/job-status";
import { readForm, validateRequest } from "@/lib/request-schema";
import { parsePage } from "@/lib/pagination";
import { readServiceHealth } from "@/lib/service-status";
import { parseSort } from "@/lib/sorting";
import { emptyFormState, type FormState, type PollResult } from "./form-state";

/**
 * Отказы, не относящиеся к конкретному полю формы.
 *
 * Отказ самого YouTube приходит завёрнутым в kind «api», и говорит о причине
 * поле reason; остальные отказы называют причину прямо в kind.
 */
function messageFor(failure: StartFailure): string {
  return failureMessage(failure.kind === "api" ? failure.reason : failure.kind);
}

/**
 * Заводит задание и сразу возвращает его id. Дожидаться выгрузки здесь нельзя:
 * канал на тысячи роликов занял бы минуты, а страница всё это время висела бы.
 *
 * Проверка идёт по той же схеме, что и в форме, но здесь она обязательна:
 * действие вызывается по сети и принимает что угодно.
 */
export async function startFetch(_prev: FormState, formData: FormData): Promise<FormState> {
  const checked = validateRequest(readForm(formData));
  if (!checked.ok) {
    return { ...emptyFormState, errors: checked.errors };
  }

  const request = checked.request;
  const started = await startJob(request.channelUrl, {
    limit: request.limit,
    includeVideos: request.includeVideos,
    includeShorts: request.includeShorts,
  });

  if (!started.ok) {
    // Сюда доходят только отказы самого YouTube: поля уже проверены.
    return { ...emptyFormState, error: messageFor(started.failure) };
  }

  return { errors: {}, error: null, runId: started.runId };
}

/**
 * Состояние задания. Строки отдаются, только когда выгрузка закончилась:
 * во время работы таблица всё равно неполная, а запрос к БД на каждый
 * опрос стоил бы дороже прогресса.
 */
const EMPTY_PAGE: VideoPage = { rows: [], total: 0, page: 1, pageCount: 1 };

export async function pollFetch(
  runId: string,
  sortColumn: string | null = null,
  sortDirection: string | null = null,
  page: number | null = null,
  pageSize: number | null = null,
): Promise<PollResult> {
  const progress = await jobProgress(runId);
  if (progress === null) {
    return { progress: null, page: EMPTY_PAGE, health: await readServiceHealth() };
  }

  // Последняя выгрузка — это она и есть, поэтому лишнего запроса к базе
  // ради строки состояния не делаем.
  const health = await readServiceHealth({ lastRun: progress });

  if (isRunning(progress.status)) return { progress, page: EMPTY_PAGE, health };

  return {
    progress,
    health,
    page: await videoPage(runId, {
      sort: parseSort(sortColumn, sortDirection),
      page: parsePage(page, pageSize),
    }),
  };
}

/**
 * Перечитывает страницу таблицы: другой порядок, другой номер или размер.
 *
 * Отдельным действием, а не повторным опросом: листать и сортировать можно
 * и когда выгрузка давно закончилась, а дёргать ради этого прогресс ни к чему.
 */
export async function fetchPage(
  runId: string,
  sortColumn: string,
  sortDirection: string,
  page: number,
  pageSize: number,
): Promise<VideoPage> {
  return videoPage(runId, {
    sort: parseSort(sortColumn, sortDirection),
    page: parsePage(page, pageSize),
  });
}
