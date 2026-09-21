/**
 * Разбор длительности в формате ISO 8601, в котором её отдаёт YouTube.
 *
 * Хранится длительность в секундах целым числом: форматирование для таблицы —
 * отдельная забота, а сравнение и порог Shorts работают с числом.
 */

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** Порог, ниже которого видео может оказаться Shorts (поднят с 60 до 180 в 2024). */
export const SHORTS_MAX_SECONDS = 180;

/**
 * `PT1M30S` → 90. Возвращает null, если строка не разбирается: у прямых эфиров
 * и недоступных видео API отдаёт `P0D` или не отдаёт поле вовсе.
 */
export function parseIsoDuration(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;

  const m = ISO_DURATION.exec(raw.trim());
  if (m === null) return null;

  const [, days, hours, minutes, seconds] = m;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return total;
}
