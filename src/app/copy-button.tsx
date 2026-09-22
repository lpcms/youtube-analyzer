"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * Кнопка «скопировать» рядом со значением.
 *
 * Ссылку на видео и его название чаще всего именно копируют — выделять мышью
 * обрезанный по ширине текст неудобно, а название в таблице ещё и обрезано
 * многоточием, то есть мышью его целиком не взять вовсе.
 *
 * Подтверждение — сменой значка на галочку и сменой подписи: всплывающее
 * уведомление ради двух слов было бы тяжелее самого действия.
 */

export type CopyKind = "link" | "text";

/** Сколько держится галочка. Достаточно, чтобы заметить, и мало, чтобы не мешать. */
const CONFIRM_MS = 1500;

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICON: Record<CopyKind | "done", ReactElement> = {
  link: (
    <>
      <path d="M9.5 14.5 14.5 9.5" {...STROKE} />
      <path d="M11 7.2 12.4 5.8a3.4 3.4 0 0 1 4.8 4.8l-1.4 1.4" {...STROKE} />
      <path d="M13 16.8 11.6 18.2a3.4 3.4 0 0 1-4.8-4.8l1.4-1.4" {...STROKE} />
    </>
  ),
  text: (
    <>
      <path d="M6 7.5h12" {...STROKE} />
      <path d="M6 12h8.5" {...STROKE} />
      <path d="M6 16.5h6" {...STROKE} />
    </>
  ),
  done: <path d="M5.5 12.3 10 16.8 18.5 8" {...STROKE} />,
};

export interface CopyButtonProps {
  /** Что кладём в буфер. */
  readonly value: string;
  readonly kind: CopyKind;
  /** Что читает скринридер и что видно во всплывающей подсказке. */
  readonly label: string;
}

export function CopyButton({ value, kind, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Таймер снимается при размонтировании: страница листается, строки уходят,
  // и setState в уже снятой строке был бы предупреждением на ровном месте.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Буфер бывает недоступен: не тот протокол, отказано в праве.
      // Молчим кнопкой, а не ломаем строку — значение всё ещё видно глазами.
      return;
    }

    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  }

  const caption = copied ? "Скопировано" : label;

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={caption}
      title={caption}
      className={`inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors ${
        copied
          ? "text-emerald-700 dark:text-emerald-400"
          : "opacity-45 hover:bg-black/8 hover:opacity-100 dark:hover:bg-white/12"
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
        {copied ? ICON.done : ICON[kind]}
      </svg>
    </button>
  );
}
