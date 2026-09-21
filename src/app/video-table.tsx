import type { VideoRow } from "@/lib/fetch-channel";
import { formatCount, formatDateTime } from "@/lib/format";
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

export function VideoTable({ rows }: { rows: readonly VideoRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-6 text-sm opacity-70">У этого канала нет видео.</p>;
  }

  return (
    <table className="mt-6 w-full border-collapse text-sm">
      <caption className="sr-only">Видео канала</caption>
      <thead>
        <tr className="border-b border-black/15 text-left dark:border-white/20">
          <th scope="col" className="py-2 pr-4 font-medium">
            URL
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Тип
          </th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            Просмотры
          </th>
          <th scope="col" className="py-2 font-medium">
            Дата
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-black/8 dark:border-white/10">
            <td className="py-2 pr-4">
              <a
                href={videoUrl(row.id)}
                target="_blank"
                // noreferrer вместе с noopener: без них открытая вкладка
                // получает доступ к window.opener.
                rel="noopener noreferrer"
                className="text-blue-700 underline underline-offset-2 dark:text-blue-400"
              >
                {videoUrl(row.id)}
              </a>
            </td>
            <td className="py-2 pr-4 whitespace-nowrap">
              <KindCell row={row} />
            </td>
            <td className="py-2 pr-4 text-right tabular-nums">{formatCount(row.viewCount)}</td>
            <td className="py-2 tabular-nums">{formatDateTime(row.publishedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
