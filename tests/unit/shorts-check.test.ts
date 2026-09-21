import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmShorts } from "@/lib/youtube/shorts-check";
import { SHORTS_MAX_SECONDS } from "@/lib/youtube/duration";
import { isShortsCandidate, resolveKinds, type FetchedVideo } from "@/lib/youtube/videos";
import { quotaSpent, resetQuotaCounter } from "@/lib/youtube/api";
import { server } from "../msw/server";

const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

/** Видео с нужной длительностью; остальное для этих тестов неважно. */
function video(id: string, durationSec: number): FetchedVideo {
  return {
    id,
    title: "",
    description: "",
    publishedAt: new Date(Date.UTC(2026, 8, 21)),
    durationSec,
    kind: durationSec <= SHORTS_MAX_SECONDS ? "SHORTS" : "VIDEO",
    kindAssumed: durationSec <= SHORTS_MAX_SECONDS,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
  };
}

beforeEach(() => {
  resetQuotaCounter();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("кандидат в Shorts по длительности", () => {
  it("порог 180 секунд включительный", () => {
    expect(isShortsCandidate(SHORTS_MAX_SECONDS)).toBe(true);
    expect(isShortsCandidate(SHORTS_MAX_SECONDS + 1)).toBe(false);
  });

  it("совсем короткое — кандидат, длинное — нет", () => {
    expect(isShortsCandidate(19)).toBe(true);
    expect(isShortsCandidate(45)).toBe(true);
    expect(isShortsCandidate(1143)).toBe(false);
  });
});

describe("подтверждение через страницу Shorts", () => {
  it("ответ 200 означает Shorts", async () => {
    server.use(http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 200 })));

    const verdicts = await confirmShorts(["aaaaaaaaaaa"]);

    expect(verdicts.get("aaaaaaaaaaa")).toBe("SHORTS");
  });

  it("редирект на /watch означает обычное видео", async () => {
    server.use(
      http.head(SHORTS_PAGE, ({ params }) =>
        HttpResponse.redirect("https://www.youtube.com/watch?v=" + String(params["id"]), 303),
      ),
    );

    const verdicts = await confirmShorts(["bbbbbbbbbbb"]);

    expect(verdicts.get("bbbbbbbbbbb")).toBe("VIDEO");
  });

  it("404 не считается за Shorts", async () => {
    // Удалённое или скрытое видео. Принять 404 за Shorts значило бы
    // выдумать тип на ровном месте.
    server.use(http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 404 })));

    const verdicts = await confirmShorts(["ccccccccccc"]);

    expect(verdicts.get("ccccccccccc")).toBe("VIDEO");
  });

  it("сетевая ошибка даёт UNKNOWN, а не догадку", async () => {
    server.use(http.head(SHORTS_PAGE, () => HttpResponse.error()));

    const verdicts = await confirmShorts(["ddddddddddd"]);

    expect(verdicts.get("ddddddddddd")).toBe("UNKNOWN");
  });

  it("идёт пакетами и не расходует квоту API", async () => {
    let inFlight = 0;
    let peak = 0;
    server.use(
      http.head(SHORTS_PAGE, async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const ids = Array.from({ length: 10 }, (_, i) => "id" + String(i).padStart(9, "0"));
    await confirmShorts(ids, { concurrency: 3 });

    expect(peak).toBeLessThanOrEqual(3);
    // Проверка идёт мимо YouTube Data API, поэтому квота не тратится.
    expect(quotaSpent()).toBe(0);
  });
});

describe("разрешение типов в выгрузке", () => {
  it("длинное видео не проверяется вовсе", async () => {
    let checked = 0;
    server.use(
      http.head(SHORTS_PAGE, () => {
        checked += 1;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const result = await resolveKinds([video("longvideo01", 1143)]);

    expect(checked).toBe(0);
    expect(result[0]?.kind).toBe("VIDEO");
    expect(result[0]?.kindAssumed).toBe(false);
  });

  it("короткое обычное видео получает тип Video, а не Shorts", async () => {
    // Решающий случай: 19 секунд, но редирект — значит не Shorts.
    server.use(
      http.head(SHORTS_PAGE, () =>
        HttpResponse.redirect("https://www.youtube.com/watch?v=shortvideo", 303),
      ),
    );

    const result = await resolveKinds([video("shortvideo1", 19)]);

    expect(result[0]?.kind).toBe("VIDEO");
    expect(result[0]?.kindAssumed).toBe(false);
  });

  it("настоящий Short получает тип Shorts и перестаёт быть предположением", async () => {
    server.use(http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 200 })));

    const result = await resolveKinds([video("realshort1", 45)]);

    expect(result[0]?.kind).toBe("SHORTS");
    expect(result[0]?.kindAssumed).toBe(false);
  });

  it("недоступность проверки не роняет выгрузку, тип остаётся предположительным", async () => {
    server.use(http.head(SHORTS_PAGE, () => HttpResponse.error()));

    const result = await resolveKinds([video("unknown0001", 45), video("longvideo01", 1143)]);

    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe("SHORTS");
    expect(result[0]?.kindAssumed).toBe(true);
    expect(result[1]?.kindAssumed).toBe(false);
  });

  it("смешанная выгрузка разбирается поштучно", async () => {
    server.use(
      http.head(SHORTS_PAGE, ({ params }) =>
        String(params["id"]).startsWith("s")
          ? new HttpResponse(null, { status: 200 })
          : HttpResponse.redirect("https://www.youtube.com/watch?v=x", 303),
      ),
    );

    const result = await resolveKinds([
      video("sshort00001", 30),
      video("vshort00001", 30),
      video("vlong000001", 900),
    ]);

    expect(result.map((v) => v.kind)).toEqual(["SHORTS", "VIDEO", "VIDEO"]);
    expect(result.every((v) => !v.kindAssumed)).toBe(true);
  });
});
