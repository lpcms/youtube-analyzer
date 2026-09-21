/**
 * Низкоуровневый клиент YouTube Data API v3.
 *
 * Только серверный код: ключ читается из YOUTUBE_API_KEY — переменной без
 * префикса NEXT_PUBLIC_, то есть в клиентский бандл он не попадает.
 *
 * `server-only` — страж на случай, если модуль однажды затянут в клиентский
 * компонент: сборка упадёт с понятной ошибкой вместо того, чтобы молча увезти
 * ключ в браузер.
 */
import "server-only";

const API_BASE = "https://www.googleapis.com/youtube/v3";

/** Цена вызова в единицах суточной квоты (10 000). */
export const QUOTA_COST = {
  "channels.list": 1,
  "playlistItems.list": 1,
  "videos.list": 1,
  /** Дорогой вызов: применяется только как фоллбэк для адресов вида /c/Name. */
  "search.list": 100,
} as const;

export type YouTubeEndpoint = keyof typeof QUOTA_COST;

export type YouTubeErrorKind =
  /** Суточная квота исчерпана — штатная ситуация, не поломка. */
  | "quota-exceeded"
  /** Ключ отсутствует, неверен или ему запрещён доступ. */
  | "bad-key"
  /** Сеть не ответила или ответ не разобрался. */
  | "network"
  /** Всё остальное, что вернул API. */
  | "api";

export class YouTubeApiError extends Error {
  constructor(
    readonly kind: YouTubeErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

/** Суммарный расход квоты за процесс — в лог, чтобы дорогие вызовы были видны. */
let spentQuota = 0;

export function quotaSpent(): number {
  return spentQuota;
}

export function resetQuotaCounter(): void {
  spentQuota = 0;
}

function apiKey(): string {
  const key = process.env["YOUTUBE_API_KEY"];
  if (key === undefined || key === "") {
    throw new YouTubeApiError("bad-key", "Не задана переменная окружения YOUTUBE_API_KEY");
  }
  return key;
}

interface ApiErrorBody {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

function classify(status: number, body: ApiErrorBody): YouTubeApiError {
  const reason = body.error?.errors?.[0]?.reason ?? "";
  const message = body.error?.message ?? "Ошибка YouTube Data API";

  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return new YouTubeApiError("quota-exceeded", "Суточная квота YouTube API исчерпана", status);
  }
  if (reason === "badRequest" || reason === "keyInvalid" || reason === "forbidden") {
    return new YouTubeApiError("bad-key", "Ключ YouTube API отклонён: " + message, status);
  }
  return new YouTubeApiError("api", message, status);
}

/**
 * Вызывает метод API и учитывает потраченную квоту.
 *
 * Расход печатается в лог: `search.list` стоит 100 единиц против 1 у остальных,
 * и без этого дорогой фоллбэк уходил бы незаметно.
 */
export async function callYouTube<T>(
  endpoint: YouTubeEndpoint,
  params: Record<string, string>,
): Promise<T> {
  const cost = QUOTA_COST[endpoint];
  const query = new URLSearchParams({ ...params, key: apiKey() });
  const method = endpoint.replace(".list", "");

  spentQuota += cost;
  console.info(
    `[youtube] ${endpoint} — ${cost} ед. квоты (всего за процесс: ${spentQuota})` +
      (cost >= 100 ? " ← дорогой вызов" : ""),
  );

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${method}?${query.toString()}`);
  } catch (cause) {
    throw new YouTubeApiError("network", "YouTube API недоступен: " + String(cause));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YouTubeApiError("network", "YouTube API вернул неразбираемый ответ", response.status);
  }

  if (!response.ok) {
    throw classify(response.status, body as ApiErrorBody);
  }

  return body as T;
}
