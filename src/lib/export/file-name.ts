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

/**
 * Время в имени файла: часы, минуты и секунды через дефис.
 *
 * Двоеточие в именах файлов запрещено, а точка спорила бы с расширением.
 */
function timeStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
}

/**
 * Запрещённые в именах файлов Windows символы плюс управляющие.
 *
 * Обратная косая здесь не для полноты списка: снимок ложится на диск
 * настоящим файлом, и название канала с `\` развело бы его по подпапкам,
 * которых никто не заводил.
 */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

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
 * Имя снимка в `history/`: `Канал-UC…-2026-09-21_14-21-05.xlsx`.
 *
 * От имени скачиваемого файла отличается двумя вещами, и обе нужны только
 * на диске. Идентификатор канала — потому что название неуникально и меняется:
 * два разных канала «Новости» слиплись бы в папке в одну кучу, а один
 * переименованный распался бы на два. Время — потому что выгрузок канала
 * бывает несколько в день, а затирать прежний снимок нельзя: на ряде снимков
 * стоит сравнение двух дат.
 */
export function snapshotFileName(channelTitle: string, channelId: string, fetchedAt: Date): string {
  const stamp = `${dateStamp(fetchedAt)}_${timeStamp(fetchedAt)}`;
  return `${safeTitle(channelTitle)}-${channelId}-${stamp}.xlsx`;
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
