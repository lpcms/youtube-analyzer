/**
 * Статусы задания выгрузки и допустимые переходы между ними.
 *
 * Вынесено отдельно от работы с БД: правила чистые и проверяются без базы.
 */

export type FetchStatus = "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

/** Завершённое задание не меняет статус: иначе история выгрузок врала бы. */
export const TERMINAL: ReadonlySet<FetchStatus> = new Set<FetchStatus>([
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
]);

export function isTerminal(status: FetchStatus): boolean {
  return TERMINAL.has(status);
}

export function isRunning(status: FetchStatus): boolean {
  return status === "RUNNING";
}

/**
 * Разрешён ли переход.
 *
 * Из RUNNING можно в любой терминальный статус. Из терминального — никуда:
 * завершённую выгрузку нельзя «перезапустить», для повтора заводится новая.
 * Переход в самого себя тоже запрещён — это всегда признак ошибки в коде,
 * а не безобидная идемпотентность.
 */
export function canTransition(from: FetchStatus, to: FetchStatus): boolean {
  if (from === to) return false;
  if (isTerminal(from)) return false;
  return isTerminal(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: FetchStatus,
    readonly to: FetchStatus,
  ) {
    super(`Недопустимый переход статуса выгрузки: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Проверяет переход и бросает, если он недопустим. */
export function assertTransition(from: FetchStatus, to: FetchStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Чем закончилась выгрузка.
 *
 * Собрали хоть что-то и остановились по причине — PARTIAL: частичный результат
 * ценнее, чем ошибка вместо него. Не собрали ничего — FAILED.
 */
export function outcomeFor(processed: number, failure: string | null): FetchStatus {
  if (failure === null) return "SUCCEEDED";
  return processed > 0 ? "PARTIAL" : "FAILED";
}

export interface JobProgress {
  readonly status: FetchStatus;
  /** Сколько подходящих строк уже сохранено. */
  readonly processed: number;
  /** Сколько всего видео на канале, по оценке API. null — пока неизвестно. */
  readonly expected: number | null;
  readonly errorReason: string | null;
}

/** Текст прогресса для интерфейса. */
export function progressLabel(progress: JobProgress): string {
  const { status, processed, expected } = progress;

  if (status === "RUNNING") {
    return expected === null ? `Получено ${processed}…` : `Получено ${processed} из ~${expected}…`;
  }
  if (status === "FAILED") return "Выгрузка не удалась";
  if (status === "PARTIAL") return `Собрано ${processed}, выгрузка прервана`;
  return `Готово: ${processed}`;
}
