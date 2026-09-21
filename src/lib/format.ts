/** Форматирование значений для таблицы. */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Дата в формате из ТЗ: `2026-09-21 14:21`.
 *
 * Собирается вручную из UTC-компонент, а не через toLocaleString: формат
 * зафиксирован ТЗ и не должен зависеть от локали и таймзоны машины.
 */
export function formatDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

/** Счётчик с разделителем разрядов; null — скрытая автором статистика. */
export function formatCount(value: number | null): string {
  return value === null ? "н/д" : value.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}
