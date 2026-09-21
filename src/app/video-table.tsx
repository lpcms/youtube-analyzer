import type { VideoRow } from "@/lib/fetch-channel";
import { formatCount, formatDateTime } from "@/lib/format";
import { videoUrl } from "@/lib/youtube/video-url";

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
            <td className="py-2 pr-4 text-right tabular-nums">{formatCount(row.viewCount)}</td>
            <td className="py-2 tabular-nums">{formatDateTime(row.publishedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
