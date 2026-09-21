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
