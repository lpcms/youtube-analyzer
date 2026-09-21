/**
 * Проверка параметров выгрузки.
 *
 * Схема живёт здесь, а не в форме: браузерная проверка — удобство, а не
 * защита. Серверное действие принимает что угодно, поэтому те же правила
 * применяются на сервере, и именно они считаются настоящими.
 */

import { z } from "zod";
import { parseChannelUrl, type ChannelUrlError } from "@/lib/youtube/channel-url";
import type { FetchLimit } from "@/lib/youtube/videos";

/** Поля, к которым может относиться ошибка. */
export type FieldName = "channelUrl" | "count" | "types";

export type FieldErrors = Partial<Record<FieldName, string>>;

export interface FetchRequest {
  readonly channelUrl: string;
  /** null — «все видео». */
  readonly limit: FetchLimit;
  readonly includeVideos: boolean;
  readonly includeShorts: boolean;
}

export type ValidationResult =
  | { readonly ok: true; readonly request: FetchRequest }
  | { readonly ok: false; readonly errors: FieldErrors };

/** Сообщения под каждый отказ разбора адреса. */
const URL_MESSAGES: Record<ChannelUrlError, string> = {
  empty: "Введите адрес канала",
  "foreign-host": "Это не адрес канала YouTube",
  unrecognized: "Адрес не похож на страницу канала",
};

const COUNT_MESSAGE = "Количество — целое число больше нуля";

/**
 * Сырой вид формы: из FormData всё приходит строками, галочки — наличием ключа.
 */
const rawSchema = z.object({
  channelUrl: z.string(),
  count: z.string(),
  allVideos: z.boolean(),
  includeVideos: z.boolean(),
  includeShorts: z.boolean(),
});

export type RawRequest = z.infer<typeof rawSchema>;

/** Читает форму в сырой вид. Галочка считается снятой, если ключа нет. */
export function readForm(formData: FormData): RawRequest {
  return {
    channelUrl: String(formData.get("channelUrl") ?? ""),
    count: String(formData.get("count") ?? ""),
    allVideos: formData.get("allVideos") !== null,
    includeVideos: formData.get("includeVideos") !== null,
    includeShorts: formData.get("includeShorts") !== null,
  };
}

/**
 * Количество: целое больше нуля.
 *
 * Разбор строгий: `Number("12abc")` даёт NaN, но `Number(" 12 ")` — 12,
 * а `Number("")` — ноль, поэтому пустая строка и пробелы отсеиваются до него.
 * Дробное число тоже отклоняется: половины видео не бывает.
 */
export function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Проверяет запрос целиком и возвращает либо готовые параметры, либо
 * сообщения по полям. Собираются все ошибки сразу: исправлять их по одной,
 * перезапуская выгрузку, — худший вид общения с формой.
 */
export function validateRequest(input: unknown): ValidationResult {
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) {
    // Сюда попадают только запросы мимо формы — например, подделанные вручную.
    return { ok: false, errors: { channelUrl: "Неверный запрос" } };
  }

  const raw = parsed.data;
  const errors: Record<string, string> = {};

  const url = parseChannelUrl(raw.channelUrl);
  if (!url.ok) {
    errors["channelUrl"] = URL_MESSAGES[url.error];
  }

  if (!raw.includeVideos && !raw.includeShorts) {
    errors["types"] = "Выберите хотя бы один тип: Video или Shorts";
  }

  let limit: FetchLimit = null;
  if (!raw.allVideos) {
    const count = parseCount(raw.count);
    if (count === null) {
      errors["count"] = COUNT_MESSAGE;
    } else {
      limit = count;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: {
      channelUrl: raw.channelUrl.trim(),
      limit,
      includeVideos: raw.includeVideos,
      includeShorts: raw.includeShorts,
    },
  };
}
