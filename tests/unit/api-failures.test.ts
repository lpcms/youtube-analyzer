import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failureMessage } from "@/lib/failure-message";
import {
  NETWORK_ATTEMPTS,
  YouTubeApiError,
  callYouTube,
  isRetryable,
  resetQuotaCounter,
  scrubKey,
} from "@/lib/youtube/api";
import { server } from "../msw/server";

/**
 * Отказы YouTube API.
 *
 * Исчерпанная квота — штатная ситуация, и вести себя как поломка она не должна.
 * Проверяется разбор ответов, повторы при молчащей сети и то, что ключ
 * не протекает в текст ошибки.
 */

const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";

function call(): Promise<unknown> {
  return callYouTube("channels.list", { part: "snippet", id: "UC1" });
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
  resetQuotaCounter();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Подменённый fetch снимается отдельно: restoreAllMocks его не трогает,
  // и он утёк бы в следующие тесты, где сеть должна работать.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("разбор отказов API", () => {
  it("исчерпанная квота опознаётся отдельно от прочих ошибок", async () => {
    server.use(
      http.get(CHANNELS, () =>
        HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        ),
      ),
    );

    await expect(call()).rejects.toMatchObject({
      kind: "quota-exceeded",
      message: "Суточная квота YouTube API исчерпана",
    });
  });

  it("суточный лимит — та же квота, другое слово", async () => {
    server.use(
      http.get(CHANNELS, () =>
        HttpResponse.json(
          { error: { message: "limit", errors: [{ reason: "dailyLimitExceeded" }] } },
          { status: 403 },
        ),
      ),
    );

    await expect(call()).rejects.toMatchObject({ kind: "quota-exceeded" });
  });

  it("непринятый ключ — не квота", async () => {
    server.use(
      http.get(CHANNELS, () =>
        HttpResponse.json(
          { error: { message: "API key not valid", errors: [{ reason: "keyInvalid" }] } },
          { status: 400 },
        ),
      ),
    );

    await expect(call()).rejects.toMatchObject({ kind: "bad-key" });
  });

  it("незаданная переменная окружения — не то же, что непринятый ключ", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");

    // Чинятся они по-разному, поэтому и называются по-разному.
    await expect(call()).rejects.toMatchObject({ kind: "missing-key" });
  });

  it("незаданный ключ не приводит к походу в сеть", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    // Обработчика нет вовсе: MSW настроен ронять незамоканные запросы,
    // поэтому поход в сеть провалил бы тест сам.
    await expect(call()).rejects.toBeInstanceOf(YouTubeApiError);
  });

  it("прочий отказ API остаётся отдельным видом", async () => {
    server.use(
      http.get(CHANNELS, () =>
        HttpResponse.json(
          { error: { message: "что-то пошло не так", errors: [{ reason: "backendError" }] } },
          { status: 503 },
        ),
      ),
    );

    await expect(call()).rejects.toMatchObject({ kind: "api", status: 503 });
  });

  it("неразбираемый ответ считается сетевым сбоем, а не успехом", async () => {
    server.use(http.get(CHANNELS, () => new HttpResponse("не json", { status: 200 })));

    await expect(call()).rejects.toMatchObject({ kind: "network" });
  });
});

describe("ключ не протекает в текст ошибки", () => {
  it("пара key=… в адресе вычищается", () => {
    const text = "fetch failed: https://api/channels?part=snippet&key=AIzaSyD-СЕКРЕТ&id=UC1";

    const clean = scrubKey(text);

    expect(clean).not.toContain("AIzaSyD-СЕКРЕТ");
    expect(clean).toContain("key=…");
    // Остальное сообщение остаётся читаемым.
    expect(clean).toContain("part=snippet");
  });

  it("значение ключа вычищается и без пары key=", () => {
    vi.stubEnv("YOUTUBE_API_KEY", "СЕКРЕТНЫЙ-КЛЮЧ");

    expect(scrubKey("отказ для СЕКРЕТНЫЙ-КЛЮЧ")).not.toContain("СЕКРЕТНЫЙ-КЛЮЧ");
  });

  it("ошибка сети не уносит ключ с собой", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "СЕКРЕТНЫЙ-КЛЮЧ");
    // fetch подменяется целиком: брошенное в обработчике MSW стало бы
    // ответом 500, а нам нужен именно низовой отказ с адресом внутри.
    vi.stubGlobal("fetch", () => {
      throw new Error("connect ECONNREFUSED https://api/channels?key=СЕКРЕТНЫЙ-КЛЮЧ");
    });

    const error = await call().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(String((error as Error).message)).not.toContain("СЕКРЕТНЫЙ-КЛЮЧ");
  });

  it("текст от самого API тоже чистится", () => {
    vi.stubEnv("YOUTUBE_API_KEY", "СЕКРЕТНЫЙ-КЛЮЧ");

    const error = new YouTubeApiError("api", "ключ СЕКРЕТНЫЙ-КЛЮЧ отклонён");

    expect(error.message).not.toContain("СЕКРЕТНЫЙ-КЛЮЧ");
  });
});

describe("повторы при молчащей сети", () => {
  it("сетевой сбой повторяется ограниченное число раз", async () => {
    let calls = 0;
    server.use(
      http.get(CHANNELS, () => {
        calls += 1;
        // Именно обрыв связи: брошенное в обработчике MSW превратило бы
        // ответ в 500, а это уже другой вид отказа.
        return HttpResponse.error();
      }),
    );

    await expect(call()).rejects.toMatchObject({ kind: "network" });

    // Ограниченное — значит именно столько, а не «пока не получится».
    expect(calls).toBe(NETWORK_ATTEMPTS);
  });

  it("ответ со второй попытки принимается как успех", async () => {
    let calls = 0;
    server.use(
      http.get(CHANNELS, () => {
        calls += 1;
        if (calls === 1) return HttpResponse.error();
        return HttpResponse.json({ items: [] });
      }),
    );

    await expect(call()).resolves.toEqual({ items: [] });
    expect(calls).toBe(2);
  });

  it("сбой на стороне Google тоже повторяется", async () => {
    let calls = 0;
    server.use(
      http.get(CHANNELS, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { message: "backend", errors: [{ reason: "backendError" }] } },
          { status: 503 },
        );
      }),
    );

    await expect(call()).rejects.toMatchObject({ kind: "api" });
    expect(calls).toBe(NETWORK_ATTEMPTS);
  });

  it("исчерпанная квота не повторяется: ответ не изменится", async () => {
    let calls = 0;
    server.use(
      http.get(CHANNELS, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        );
      }),
    );

    await expect(call()).rejects.toMatchObject({ kind: "quota-exceeded" });
    expect(calls).toBe(1);
  });

  it("непринятый ключ не повторяется", async () => {
    let calls = 0;
    server.use(
      http.get(CHANNELS, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { message: "key", errors: [{ reason: "keyInvalid" }] } },
          { status: 400 },
        );
      }),
    );

    await expect(call()).rejects.toMatchObject({ kind: "bad-key" });
    expect(calls).toBe(1);
  });

  it("признак повторяемости назван явно", () => {
    expect(isRetryable(new YouTubeApiError("network", "нет сети"))).toBe(true);
    expect(isRetryable(new YouTubeApiError("api", "сбой", 503))).toBe(true);
    expect(isRetryable(new YouTubeApiError("api", "не найдено", 404))).toBe(false);
    expect(isRetryable(new YouTubeApiError("quota-exceeded", "квота", 403))).toBe(false);
    expect(isRetryable(new YouTubeApiError("bad-key", "ключ", 400))).toBe(false);
  });
});

describe("сообщения об отказах", () => {
  it("каждый вид отказа назван по-человечески", () => {
    expect(failureMessage("quota-exceeded")).toContain("квота");
    expect(failureMessage("missing-key")).toContain(".env");
    expect(failureMessage("bad-key")).toContain("не принят");
    expect(failureMessage("network")).toContain("не отвечает");
    expect(failureMessage("not-found")).toBe("Канал не найден");
  });

  it("незнакомый код не показывается как есть", () => {
    // Пользователю «zzz-unknown» ничего не говорит и выглядит протечкой.
    const text = failureMessage("zzz-unknown");

    expect(text).not.toContain("zzz-unknown");
    expect(text).toBe("Не удалось выгрузить канал");
  });

  it("отсутствие причины тоже даёт текст, а не пустоту", () => {
    expect(failureMessage(null)).toBe("Не удалось выгрузить канал");
  });

  it("ни в одном сообщении нет кода отказа", () => {
    // Коды — для журнала и кода, а не для экрана.
    for (const reason of ["quota-exceeded", "missing-key", "bad-key", "network", "api"]) {
      expect(failureMessage(reason)).not.toContain(reason);
    }
  });
});
