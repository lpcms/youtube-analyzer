/**
 * Имя файла выгрузки и заголовок, которым он отдаётся браузеру.
 *
 * Вынесено отдельно от сборки книги: это чистые строковые правила,
 * и проверять их дешевле без создания книги Excel.
 */

/** Дата в имени файла: тот же порядок, что и в таблице, только без времени. */
function dateStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Запрещённые в именах файлов Windows символы плюс управляющие. */
const FORBIDDEN = /[\/:*?"<>|\u0000-\u001f]/g;

/** Длиннее незачем: у путей есть предел, а название канала бывает любым. */
const MAX_TITLE = 60;

const FALLBACK_TITLE = "Канал";

/**
 * Приводит название канала к безопасному куску имени файла.
 *
 * Пустой остаток заменяется словом «Канал»: файл с именем `-2026-09-21.xlsx`
 * выглядел бы поломкой, хотя выгрузка прошла нормально.
 */
export function safeTitle(title: string): string {
  const cleaned = title
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Точка в конце имени файла в Windows отбрасывается молча.
    .replace(/\.+$/, "")
    .trim();

  if (cleaned === "") return FALLBACK_TITLE;
  return cleaned.length <= MAX_TITLE ? cleaned : cleaned.slice(0, MAX_TITLE).trimEnd();
}

/** `Канал для E2E-2026-09-21.xlsx` */
export function exportFileName(channelTitle: string, fetchedAt: Date): string {
  return `${safeTitle(channelTitle)}-${dateStamp(fetchedAt)}.xlsx`;
}

/**
 * Заголовок Content-Disposition.
 *
 * Имя даётся дважды: в кавычках — запасное из одних латинских букв, и через
 * `filename*` — настоящее в UTF-8. Кириллицу в обычном `filename` браузеры
 * разбирают по-разному, вплоть до «п»‑образной каши в имени скачанного файла.
 */
export function contentDisposition(fileName: string, fetchedAt: Date): string {
  const ascii = `youtube-${dateStamp(fetchedAt)}.xlsx`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
