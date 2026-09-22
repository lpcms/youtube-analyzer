"use client";

import { useState, useTransition } from "react";
import { removeChannel } from "./actions";
import { openRunId } from "./form-state";

/**
 * Удаление канала из истории.
 *
 * Подтверждение спрашивается прямо в строке, а не системным confirm():
 * его нельзя оформить, он теряется на втором мониторе, а главное — окно
 * браузера блокирует страницу целиком. Здесь же видно, какой именно канал
 * сейчас удаляют.
 */
export function DeleteChannel({
  channelId,
  title,
  onDeleted,
}: {
  channelId: string;
  title: string;
  /** Зовётся после удаления: список перечитывает тот, кто им владеет. */
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm(): void {
    startTransition(async () => {
      const result = await removeChannel(channelId, openRunId());

      // Со страницы уводим, только если исчезла именно открытая выгрузка.
      // Таблицу соседнего канала сносить заодно незачем.
      if (result.openRunGone) {
        // Именно перезагрузка, а не router.push, который советует правило:
        // идентификатор открытой выгрузки лежит не только в адресе, но и
        // в состоянии формы (useActionState), куда снаружи не дотянуться.
        // После router.push таблица удалённого канала осталась бы на экране.
        // Данные под страницей уничтожены — полная перезагрузка тут и есть
        // верная семантика, а не потеря клиентской навигации.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/");
        return;
      }

      onDeleted();
    });
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded border border-black/15 px-2 py-1 text-xs opacity-70 hover:border-red-500/50 hover:text-red-700 hover:opacity-100 dark:border-white/20 dark:hover:text-red-400"
      >
        Удалить
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {/* Вопрос называет канал: в списке из пяти строк «Удалить?» без имени
          — это приглашение ошибиться. */}
      <span className="text-red-700 dark:text-red-400">Удалить «{title}» со всеми выгрузками?</span>
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="rounded bg-red-600 px-2 py-1 font-medium text-white disabled:opacity-60"
      >
        {pending ? "Удаляю…" : "Да, удалить"}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        disabled={pending}
        className="rounded border border-black/20 px-2 py-1 dark:border-white/25"
      >
        Отмена
      </button>
    </span>
  );
}
