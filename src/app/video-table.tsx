import type { VideoRow } from "@/lib/fetch-channel";
import {
  descriptionPreview,
  formatCount,
  formatDateTime,
  formatDuration,
  formatVirality,
  isDescriptionTruncated,
} from "@/lib/format";
import { videoUrl } from "@/lib/youtube/video-url";

const KIND_LABEL = { VIDEO: "Video", SHORTS: "Shorts" } as const;

function KindCell({ row }: { row: VideoRow }) {
  const label = KIND_LABEL[row.kind];

  if (!row.kindAssumed) {
    return <>{label}</>;
  }

  // Подтвердить тип не удалось — он выведен из одной длительности.
  // Помечаем честно, вместо того чтобы выдавать догадку за факт.
  return (
    <span
      title="Тип определён по длительности: подтвердить через страницу Shorts не удалось"
      className="border-b border-dotted border-current opacity-70"
    >
      {label}&nbsp;?
    </span>
  );
}

/**
 * Описание.
 *
 * Выводится как текст: React экранирует значение сам, поэтому разметка внутри
 * описания остаётся видимым текстом и не исполняется. Это важно — в описаниях
 * попадается произвольный HTML.
 *
 * Длинное сокращается, но полный текст доступен через details: он работает
 * с клавиатуры и без JavaScript, в отличие от всплывающей подсказки.
 */
function DescriptionCell({ text }: { text: string }) {
  if (text.trim() === "") {
    return <span className="opacity-40">—</span>;
  }

  if (!isDescriptionTruncated(text)) {
    return <span className="whitespace-pre-wrap">{text.trim()}</span>;
  }

  return (
    <details className="group">
      <summary className="cursor-pointer list-none marker:content-none">
        <span className="group-open:hidden">{descriptionPreview(text)}</span>
        <span className="hidden text-xs underline underline-offset-2 opacity-60 group-open:inline">
          свернуть
        </span>
      </summary>
      <span className="mt-1 block whitespace-pre-wrap">{text.trim()}</span>
    </details>
  );
}

/** Заголовки колонок в порядке из ТЗ. */
const NUMERIC = "py-2 pr-4 text-right tabular-nums";

export function VideoTable({ rows }: { rows: readonly VideoRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-6 text-sm opacity-70">У этого канала нет видео.</p>;
  }

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-5xl border-collapse text-sm">
        <caption className="sr-only">Видео канала с метриками</caption>
        <thead>
          <tr className="border-b border-black/15 text-left dark:border-white/20">
            <th scope="col" className="py-2 pr-4 font-medium">
              URL
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Тип
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Длительность
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Просмотры
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Лайки
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Комментарии
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Вирусность
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Дата
            </th>
            <th scope="col" className="py-2 font-medium">
              Описание
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-black/8 align-top dark:border-white/10">
              {/* Ссылка — опознавательная ячейка строки, поэтому th со scope="row". */}
              <th scope="row" className="py-2 pr-4 font-normal whitespace-nowrap">
                <a
                  href={videoUrl(row.id)}
                  target="_blank"
                  // noreferrer вместе с noopener: без них открытая вкладка
                  // получает доступ к window.opener.
                  rel="noopener noreferrer"
                  title={row.title}
                  className="text-blue-700 underline underline-offset-2 dark:text-blue-400"
                >
                  {videoUrl(row.id)}
                </a>
              </th>
              <td className="py-2 pr-4 whitespace-nowrap">
                <KindCell row={row} />
              </td>
              <td className={NUMERIC}>{formatDuration(row.durationSec)}</td>
              <td className={NUMERIC}>{formatCount(row.viewCount)}</td>
              <td className={NUMERIC}>{formatCount(row.likeCount)}</td>
              <td className={NUMERIC}>{formatCount(row.commentCount)}</td>
              <td className={NUMERIC}>{formatVirality(row.viralityScore)}</td>
              <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                {formatDateTime(row.publishedAt)}
              </td>
              <td className="max-w-md py-2">
                <DescriptionCell text={row.description} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
