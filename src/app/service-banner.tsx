"use client";

import {
  QUOTA_HINT,
  healthMessage,
  healthTone,
  quotaMessage,
  type HealthTone,
  type ServiceHealth,
} from "@/lib/service-health";

/**
 * Строка состояния сервиса.
 *
 * Стоит над формой и отвечает на вопрос, который иначе выясняется только
 * нажатием «Начать»: работает сервис или нет. Незаданный ключ виден сразу,
 * исчерпанная квота — до следующей попытки, а не после неё.
 *
 * Цвет не единственный носитель смысла: рядом с ним слово. Различать
 * жёлтое и красное умеют не все, а прочитать «квота исчерпана» может каждый.
 */
const TONE: Record<
  HealthTone,
  { readonly box: string; readonly dot: string; readonly word: string }
> = {
  ok: {
    box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
    dot: "bg-emerald-500",
    word: "Готов",
  },
  warn: {
    box: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
    dot: "bg-amber-500",
    word: "Внимание",
  },
  error: {
    box: "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200",
    dot: "bg-red-500",
    word: "Не работает",
  },
};

export function ServiceBanner({ health }: { health: ServiceHealth }) {
  const tone = healthTone(health);
  const look = TONE[tone];

  return (
    <div
      id="service-status"
      data-tone={tone}
      // role="status" сам по себе даёт вежливое объявление: состояние меняется
      // без участия пользователя, и уводить на него фокус не нужно.
      role="status"
      className={`mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm ${look.box}`}
    >
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${look.dot}`} />
      <span className="font-semibold">{look.word}.</span>
      <span>{healthMessage(health)}</span>

      <span
        id="quota-spent"
        title={QUOTA_HINT}
        className="ml-auto cursor-help tabular-nums opacity-70"
      >
        {quotaMessage(health)}
      </span>
    </div>
  );
}
