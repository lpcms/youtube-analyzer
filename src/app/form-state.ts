import type { VideoRow } from "@/lib/fetch-channel";

/**
 * Состояние формы. Живёт отдельно от actions.ts: модуль с "use server"
 * может экспортировать только асинхронные функции, а константа и тип
 * оттуда ломают сборку.
 */
export interface FormState {
  readonly error: string | null;
  readonly channelId: string | null;
  readonly rows: readonly VideoRow[];
}

export const emptyFormState: FormState = { error: null, channelId: null, rows: [] };

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
