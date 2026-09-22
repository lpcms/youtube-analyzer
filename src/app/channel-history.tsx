"use client";

import { EMPTY_HISTORY, summaryLine, type ChannelSummary } from "@/lib/channel-summary";
import { DeleteChannel } from "./delete-channel";

/**
 * Список ранее выгруженных каналов.
 *
 * Читается из SQLite и только из неё: вернуться к уже проанализированному
 * каналу — самое частое действие после первой выгрузки, и стоить квоты
 * оно не должно.
 *
 * Канал открывается обычной ссылкой на его последнюю выгрузку. Значит,
 * история работает и без JavaScript, а таблица получает всё своё —
 * колонки, сортировку, страницы и выгрузку в Excel — просто потому,
 * что это та же самая страница.
 *
 * Первый список приходит с сервера вместе со страницей; дальше его
 * перерисовывает владелец состояния, а не пересборка всего сегмента.
 */
export interface ChannelHistoryProps {
  readonly channels: readonly ChannelSummary[];
  /** Зовётся после удаления — чтобы список перечитали. */
  readonly onChanged: () => void;
}

export function ChannelHistory({ channels, onChanged }: ChannelHistoryProps) {
  return (
    <section
      id="channel-history"
      className="mt-10 border-t border-black/10 pt-6 dark:border-white/15"
    >
      <h2 className="mb-3 text-lg font-semibold">Ранее выгруженные каналы</h2>

      {channels.length === 0 ? (
        <p className="max-w-2xl text-sm opacity-70">{EMPTY_HISTORY}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {channels.map((channel) => (
            <li
              key={channel.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-black/10 px-3 py-2 dark:border-white/15"
            >
              <div className="min-w-0 flex-1">
                {channel.latestRunId === null ? (
                  // Выгрузка не завершилась ни разу — открывать нечего.
                  <span className="font-medium">{channel.title}</span>
                ) : (
                  <a
                    href={`/?run=${encodeURIComponent(channel.latestRunId)}`}
                    className="font-medium text-blue-700 underline underline-offset-2 dark:text-blue-400"
                  >
                    {channel.title}
                  </a>
                )}
                {channel.handle !== null && (
                  <span className="ml-2 text-xs opacity-60">{channel.handle}</span>
                )}
                <p className="mt-0.5 text-xs tabular-nums opacity-70">{summaryLine(channel)}</p>
              </div>

              <DeleteChannel channelId={channel.id} title={channel.title} onDeleted={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
