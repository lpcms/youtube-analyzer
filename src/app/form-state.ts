import type { VideoPage } from "@/lib/fetch-channel";
import type { JobProgress } from "@/lib/job-status";
import type { ServiceHealth } from "@/lib/service-health";
import type { FieldErrors } from "@/lib/request-schema";

/**
 * Состояние формы. Живёт отдельно от actions.ts: модуль с "use server"
 * может экспортировать только асинхронные функции, а константы и типы
 * оттуда ломают сборку.
 */
export interface FormState {
  /** Ошибки по полям: сообщение показывается под своим полем. */
  readonly errors: FieldErrors;
  /** Отказ, не относящийся к конкретному полю: канал не найден, квота, сеть. */
  readonly error: string | null;
  readonly runId: string | null;
}

export const emptyFormState: FormState = { errors: {}, error: null, runId: null };

/** Ответ на опрос задания. */
export interface PollResult {
  readonly progress: JobProgress | null;
  readonly page: VideoPage;
  /**
   * Состояние сервиса на момент ответа. Приезжает вместе с прогрессом,
   * чтобы строка состояния не устаревала до перезагрузки страницы.
   */
  readonly health: ServiceHealth;
}

/** Значения формы при первой загрузке: обе галочки включены — это из ТЗ. */
export interface FormDefaults {
  readonly includeVideos: boolean;
  readonly includeShorts: boolean;
  readonly allVideos: boolean;
  readonly count: number;
}

export const DEFAULTS: FormDefaults = {
  includeVideos: true,
  includeShorts: true,
  allVideos: true,
  count: 50,
};

/**
 * Адрес страницы помнит идентификатор выгрузки: перезагрузка её не теряет,
 * а история открывает канал обычной ссылкой на его последнюю выгрузку.
 */
export const RUN_PARAM = "run";

/** Какая выгрузка открыта сейчас. На сервере адреса нет — там null. */
export function openRunId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(RUN_PARAM);
}

/** Как часто интерфейс спрашивает о прогрессе. */
export const POLL_INTERVAL_MS = 700;

/** Идентификаторы элементов с сообщениями — на них смотрит aria-describedby. */
export const ERROR_ID = {
  channelUrl: "channelUrl-error",
  count: "count-error",
  types: "types-error",
} as const;
