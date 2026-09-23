/**
 * Состояние сервиса — ответ на вопрос «он вообще работает?».
 *
 * До сих пор узнать об этом можно было единственным способом: нажать «Начать»
 * и подождать отказа. Незаданный ключ или исчерпанная квота — вещи, про которые
 * честнее сказать заранее.
 *
 * Состояние считается **без единого обращения к API**: ключ проверяется
 * по переменной окружения, последняя выгрузка берётся из базы, расход квоты —
 * из счётчика процесса. Проверять связь «пингом» значило бы тратить квоту
 * на каждое открытие страницы.
 *
 * Модуль намеренно без `server-only`: правила нужны и в клиентском компоненте.
 * Ничего секретного в нём нет — сюда попадает только признак «ключ задан»,
 * но не сам ключ.
 */

import { failureMessage } from "@/lib/failure-message";
import { formatCount } from "@/lib/format";
import type { FetchStatus } from "@/lib/job-status";

/** Суточная квота YouTube Data API. */
export const QUOTA_LIMIT = 10_000;

export type HealthTone = "ok" | "warn" | "error";

export interface ServiceHealth {
  /** Задан ли YOUTUBE_API_KEY. Сам ключ сюда не попадает — только признак. */
  readonly keyConfigured: boolean;
  /** Чем кончилась последняя выгрузка; null — выгрузок ещё не было. */
  readonly lastRun: {
    readonly status: FetchStatus;
    readonly errorReason: string | null;
  } | null;
  /** Израсходовано единиц квоты с запуска сервера. */
  readonly quotaSpent: number;
}

/** Отказы, которые чинит настройка, а не ожидание. */
const BROKEN: ReadonlySet<string> = new Set(["missing-key", "bad-key"]);

/**
 * Насколько всё плохо.
 *
 * Незаданный ключ — «error»: сервис не заработает вовсе, и это надо чинить.
 * Исчерпанная квота — «warn», а не «error»: это штатная ситуация, к завтрашнему
 * дню она пройдёт сама, и пугать красным незачем.
 */
export function healthTone(health: ServiceHealth): HealthTone {
  if (!health.keyConfigured) return "error";

  const reason = health.lastRun?.errorReason ?? null;
  if (reason === null) return "ok";
  if (BROKEN.has(reason)) return "error";
  return "warn";
}

/** Строка состояния: что именно сейчас не так — или что всё в порядке. */
export function healthMessage(health: ServiceHealth): string {
  if (!health.keyConfigured) {
    return "Ключ YouTube API не задан — выгрузка не заработает. Проверьте YOUTUBE_API_KEY в файле .env";
  }

  const reason = health.lastRun?.errorReason ?? null;
  if (reason === null) {
    return health.lastRun === null ? "Сервис готов к работе" : "Сервис работает";
  }

  if (reason === "quota-exceeded") {
    return "Суточная квота YouTube API исчерпана — до её обновления новые выгрузки не пойдут";
  }
  if (reason === "network") {
    return "YouTube API не ответил при последней выгрузке — возможно, нет связи";
  }

  // Остальное описано там же, где и отказы формы: два списка разошлись бы.
  return "Последняя выгрузка остановилась: " + failureMessage(reason).toLowerCase();
}

/**
 * Подпись о расходе квоты.
 *
 * Единица измерения названа прямо: «0 из 10 000» без неё читается как штуки
 * видео или запросы, а это условные единицы YouTube — у разных вызовов
 * разная цена. Разряды разделены, иначе «10000» считывается не с первого
 * взгляда.
 */
export function quotaMessage(health: ServiceHealth): string {
  return `Квота: ${formatCount(health.quotaSpent)} из ${formatCount(QUOTA_LIMIT)} единиц`;
}

/**
 * Пояснение к расходу мелким шрифтом не поместится, поэтому живёт
 * во всплывающей подсказке: счётчик считает с запуска сервера, а не с полуночи,
 * и выдавать его за точный остаток нельзя.
 */
export const QUOTA_HINT =
  "Израсходовано с момента запуска сервера. YouTube считает свою квоту " +
  "посуточно и обнуляет её около полуночи по тихоокеанскому времени, " +
  "поэтому это оценка снизу, а не точный остаток.";
