/** Ссылки на страницы YouTube по идентификатору видео. */

/**
 * Адрес сайта для проверки типа Shorts. Переопределяется только в тестах:
 * иначе E2E ходил бы на настоящий youtube.com, а этого правила
 * («ни один тест не ходит в живой YouTube») быть не должно.
 *
 * Ссылки в таблице всегда указывают на настоящий сайт — их формирует videoUrl.
 */
function webBase(): string {
  return process.env["YOUTUBE_WEB_BASE"] ?? "https://www.youtube.com";
}

/** Обычная страница просмотра. Открывается и для Shorts. */
export function videoUrl(videoId: string): string {
  return "https://www.youtube.com/watch?v=" + videoId;
}

/**
 * Страница Shorts. Нужна для подтверждения типа: настоящий Short отвечает
 * страницей, обычное видео уходит редиректом на /watch.
 */
export function shortsUrl(videoId: string): string {
  return webBase() + "/shorts/" + videoId;
}
