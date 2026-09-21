/** Ссылки на страницы YouTube по идентификатору видео. */

/** Обычная страница просмотра. Открывается и для Shorts. */
export function videoUrl(videoId: string): string {
  return "https://www.youtube.com/watch?v=" + videoId;
}

/**
 * Страница Shorts. Нужна для подтверждения типа: настоящий Short отвечает
 * страницей, обычное видео уходит редиректом на /watch.
 */
export function shortsUrl(videoId: string): string {
  return "https://www.youtube.com/shorts/" + videoId;
}
