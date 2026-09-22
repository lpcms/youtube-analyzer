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

/**
 * Адрес API. Переопределяется переменной окружения только ради E2E: запрос
 * к YouTube уходит с сервера Next, и перехватить его из браузера нечем,
 * поэтому на время прогона сервер смотрит на локальную заглушку.
 */
const API_BASE = process.env["YOUTUBE_API_BASE"] ?? "https://www.googleapis.com/youtube/v3";

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
  /** Переменная окружения не задана: чинится настройкой, а не ожиданием. */
  | "missing-key"
  /** Ключ задан, но API его не принял: неверен или ему запрещён доступ. */
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
    // Ключ вычищается на входе, а не на выходе: сообщение уходит и в лог,
    // и на экран, и забыть про него можно ровно один раз.
    super(scrubKey(message));
    this.name = "YouTubeApiError";
  }
}

/**
 * Убирает ключ API из текста.
 *
 * Сообщение об ошибке показывается пользователю и попадает в лог, а ключ
 * живёт в строке запроса — низовая ошибка сети вполне может притащить с собой
 * весь адрес. Вычищается и пара `key=…`, и само значение ключа: оно могло
 * попасть в текст и отдельно.
 */
export function scrubKey(text: string): string {
  const masked = text.replace(/([?&]key=)[^&\s"']+/gi, "$1…");

  const key = process.env["YOUTUBE_API_KEY"];
  if (key === undefined || key === "") return masked;

  return masked.split(key).join("…");
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
    throw new YouTubeApiError("missing-key", "Не задана переменная окружения YOUTUBE_API_KEY");
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
 * Сколько раз пытаться, когда не ответила сеть.
 *
 * Попытки ограничены и невелики: выгрузка идёт при пользователе, и лучше
 * закончить её частичным результатом, чем молотить в недоступную сеть,
 * пока он смотрит на счётчик. Собранное к этому моменту уже в базе.
 */
export const NETWORK_ATTEMPTS = 3;

/** Пауза перед повтором, растущая с номером попытки: 300 мс, затем 600 мс. */
export const RETRY_DELAY_MS = 300;

/**
 * Стоит ли повторять.
 *
 * Только то, что может пройти со второго раза: молчащая сеть и сбой на стороне
 * Google. Исчерпанную квоту и непринятый ключ повторять бессмысленно — ответ
 * не изменится, а время и попытки потратятся.
 */
export function isRetryable(error: YouTubeApiError): boolean {
  if (error.kind === "network") return true;
  return error.kind === "api" && error.status !== undefined && error.status >= 500;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function requestOnce<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
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

/**
 * Вызывает метод API и учитывает потраченную квоту.
 *
 * Расход печатается в лог: `search.list` стоит 100 единиц против 1 у остальных,
 * и без этого дорогой фоллбэк уходил бы незаметно.
 *
 * Квота считается один раз на вызов, а не на попытку: запрос, не дошедший
 * до Google, у него ничего не списывает.
 */
export async function callYouTube<T>(
  endpoint: YouTubeEndpoint,
  params: Record<string, string>,
): Promise<T> {
  const cost = QUOTA_COST[endpoint];
  const query = new URLSearchParams({ ...params, key: apiKey() });
  const method = endpoint.replace(".list", "");
  const url = `${API_BASE}/${method}?${query.toString()}`;

  spentQuota += cost;
  console.info(
    `[youtube] ${endpoint} — ${cost} ед. квоты (всего за процесс: ${spentQuota})` +
      (cost >= 100 ? " ← дорогой вызов" : ""),
  );

  let last: YouTubeApiError | null = null;

  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce<T>(url);
    } catch (e) {
      if (!(e instanceof YouTubeApiError) || !isRetryable(e)) throw e;

      last = e;
      if (attempt < NETWORK_ATTEMPTS) {
        console.info(`[youtube] ${endpoint} — попытка ${attempt} не удалась, повторяю`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw last ?? new YouTubeApiError("network", "YouTube API недоступен");
}
