/**
 * Человеческие сообщения об отказах.
 *
 * Один список на всё приложение: отказ при запуске показывает форма,
 * а отказ на середине выгрузки — строка «Причина остановки» под таблицей.
 * Раньше вторая печатала код вида `quota-exceeded` — понятный коду, но не
 * человеку. Держать два списка значило бы обречь их разойтись.
 *
 * Модуль намеренно без `server-only`: тексты нужны и в клиентском компоненте.
 * Ничего секретного в нём нет.
 */

/** Ключи — это `kind` отказа запуска и `errorReason` выгрузки. */
export const FAILURE_MESSAGES: Record<string, string> = {
  "not-found": "Канал не найден",
  "quota-exceeded": "Суточная квота YouTube API исчерпана — попробуйте завтра",
  "missing-key": "Не задан ключ YouTube API: проверьте YOUTUBE_API_KEY в файле .env",
  "bad-key": "Ключ YouTube API не принят: проверьте YOUTUBE_API_KEY",
  network: "YouTube API не отвечает — выгрузка остановлена после нескольких попыток",
  api: "YouTube API вернул ошибку",
  unknown: "Не удалось выгрузить канал",
};

const FALLBACK = FAILURE_MESSAGES["unknown"] ?? "Не удалось выгрузить канал";

/**
 * Сообщение по коду отказа.
 *
 * Незнакомый код не показывается как есть: пользователю он ничего не говорит,
 * а выглядит как протёкшая наружу внутренность.
 */
export function failureMessage(reason: string | null): string {
  if (reason === null) return FALLBACK;
  return FAILURE_MESSAGES[reason] ?? FALLBACK;
}
