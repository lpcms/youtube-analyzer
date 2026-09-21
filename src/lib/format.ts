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

/**
 * Длительность: `1:30` для полутора минут, `1:02:03` для часа с небольшим.
 *
 * Часы показываются только когда они есть — `0:01:30` читается хуже, чем `1:30`.
 * Минуты дополняются нулём лишь при наличии часов, иначе получилось бы `01:30`.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** Счётчик с разделителем разрядов; null — скрытая автором статистика. */
export function formatCount(value: number | null): string {
  // Неразрывный пробел от Intl заменяется обычным: в таблице он ничего
  // не даёт, а в тестах и при копировании только мешает.
  return value === null ? "н/д" : value.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

/** Вирусность: одна цифра после запятой, «н/д» пока не посчитана. */
export function formatVirality(value: number | null): string {
  return value === null ? "н/д" : value.toFixed(1).replace(".", ",");
}

/** Сколько символов описания показывать в ячейке до сокращения. */
export const DESCRIPTION_PREVIEW = 120;

/** Первая строка описания, обрезанная до предела. */
export function descriptionPreview(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  const source = firstLine.trim() === "" ? text.trim() : firstLine.trim();

  return source.length <= DESCRIPTION_PREVIEW
    ? source
    : source.slice(0, DESCRIPTION_PREVIEW).trimEnd() + "…";
}

/** Нужно ли давать возможность раскрыть описание целиком. */
export function isDescriptionTruncated(text: string): boolean {
  return text.trim() !== "" && descriptionPreview(text) !== text.trim();
}
