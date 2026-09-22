import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRun, jobProgress, runJob } from "@/lib/fetch-job";
import {
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isTerminal,
  outcomeFor,
  progressLabel,
  type FetchStatus,
  type JobProgress,
} from "@/lib/job-status";
import { NETWORK_ATTEMPTS, resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

describe("переходы статуса задания", () => {
  it("из RUNNING можно в любой терминальный статус", () => {
    expect(canTransition("RUNNING", "SUCCEEDED")).toBe(true);
    expect(canTransition("RUNNING", "PARTIAL")).toBe(true);
    expect(canTransition("RUNNING", "FAILED")).toBe(true);
  });

  it("из терминального — никуда", () => {
    const terminal: FetchStatus[] = ["SUCCEEDED", "PARTIAL", "FAILED"];
    for (const from of terminal) {
      expect(isTerminal(from)).toBe(true);
      expect(canTransition(from, "RUNNING")).toBe(false);
      expect(canTransition(from, "SUCCEEDED")).toBe(false);
    }
  });

  it("переход в самого себя запрещён", () => {
    // Всегда признак ошибки в коде, а не безобидная идемпотентность.
    expect(canTransition("RUNNING", "RUNNING")).toBe(false);
    expect(canTransition("SUCCEEDED", "SUCCEEDED")).toBe(false);
  });

  it("недопустимый переход бросает понятную ошибку", () => {
    expect(() => assertTransition("SUCCEEDED", "RUNNING")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("RUNNING", "SUCCEEDED")).not.toThrow();
  });
});

describe("исход выгрузки", () => {
  it("без сбоя — SUCCEEDED", () => {
    expect(outcomeFor(10, null)).toBe("SUCCEEDED");
    expect(outcomeFor(0, null)).toBe("SUCCEEDED");
  });

  it("сбой после собранного — PARTIAL, частичный результат ценнее ошибки", () => {
    expect(outcomeFor(50, "quota-exceeded")).toBe("PARTIAL");
  });

  it("сбой без единой строки — FAILED", () => {
    expect(outcomeFor(0, "quota-exceeded")).toBe("FAILED");
  });
});

describe("текст прогресса", () => {
  /** Ничего не исчезло — обычный случай, и лишний счёт в тестах только мешает. */
  const progress = (
    over: Partial<JobProgress> & Pick<JobProgress, "status" | "processed">,
  ): JobProgress => ({
    expected: null,
    errorReason: null,
    vanished: 0,
    channelId: CHANNEL_ID,
    channelTitle: "Канал",
    fetchedAt: null,
    ...over,
  });

  it("во время работы показывает собранное и оценку", () => {
    expect(progressLabel(progress({ status: "RUNNING", processed: 350, expected: 5000 }))).toBe(
      "Получено 350 из ~5000 видео",
    );
  });

  it("без оценки показывает только собранное", () => {
    expect(progressLabel(progress({ status: "RUNNING", processed: 12 }))).toBe("Получено 12 видео");
  });

  it("прерванная выгрузка сообщает, сколько успели", () => {
    expect(
      progressLabel(
        progress({ status: "PARTIAL", processed: 40, expected: 200, errorReason: "quota" }),
      ),
    ).toBe("Собрано 40, выгрузка прервана");
  });

  it("готовая выгрузка без пропаж не говорит о них", () => {
    expect(progressLabel(progress({ status: "SUCCEEDED", processed: 137 }))).toBe("Готово: 137");
  });

  it("исчезнувшие с канала названы отдельно", () => {
    expect(progressLabel(progress({ status: "SUCCEEDED", processed: 135, vanished: 2 }))).toBe(
      "Готово: 135. Исчезло с канала: 2",
    );
  });

  it("одно исчезнувшее видео не ломает согласование", () => {
    // «Исчезло» безлично: верно и для одного, и для пяти.
    expect(progressLabel(progress({ status: "SUCCEEDED", processed: 1, vanished: 1 }))).toBe(
      "Готово: 1. Исчезло с канала: 1",
    );
  });
});

/** Канал из 120 видео: три страницы по 50, 50 и 20. */
const TOTAL = 120;
const ids = Array.from({ length: TOTAL }, (_, i) =>
  ("v" + String(i).padStart(10, "0")).slice(0, 11),
);

function mockChannel(
  options: { failOnPage?: number; holdFromPage?: number; dropFromPage?: number } = {},
) {
  let playlistCalls = 0;
  let openGate: (() => void) | null = null;
  // Ворота: страница за ними не отвечает, пока тест их не откроет. Так
  // промежуточное состояние проверяется точно, а не «успеем поймать таймером».
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  server.use(
    http.get(CHANNELS, () =>
      HttpResponse.json({
        items: [
          {
            id: CHANNEL_ID,
            snippet: { title: "Канал", customUrl: "@bigchannel", thumbnails: {} },
            contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
          },
        ],
      }),
    ),

    http.get(PLAYLIST_ITEMS, async ({ request }) => {
      playlistCalls += 1;

      if (options.holdFromPage !== undefined && playlistCalls > options.holdFromPage) {
        await gate;
      }

      if (options.failOnPage !== undefined && playlistCalls > options.failOnPage) {
        return HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        );
      }

      // Обрыв связи, а не ответ об ошибке: брошенное в обработчике MSW
      // превратилось бы в 500, а это другой вид отказа.
      if (options.dropFromPage !== undefined && playlistCalls > options.dropFromPage) {
        return HttpResponse.error();
      }

      const params = new URL(request.url).searchParams;
      const max = Number(params.get("maxResults") ?? "50");
      const offset = Number(params.get("pageToken") ?? "0");
      const slice = ids.slice(offset, offset + max);
      const next = offset + slice.length;

      return HttpResponse.json({
        items: slice.map((id) => ({ contentDetails: { videoId: id } })),
        pageInfo: { totalResults: TOTAL },
        ...(next < ids.length ? { nextPageToken: String(next) } : {}),
      });
    }),

    http.get(VIDEOS, ({ request }) => {
      const requested = (new URL(request.url).searchParams.get("id") ?? "").split(",");
      return HttpResponse.json({
        items: requested.map((id) => ({
          id,
          snippet: {
            title: "",
            description: "",
            publishedAt: new Date(Date.UTC(2026, 0, 1 + ids.indexOf(id), 12, 0)).toISOString(),
          },
          contentDetails: { duration: "PT10M" },
          statistics: { viewCount: "100", likeCount: "10", commentCount: "1" },
        })),
      });
    }),

    http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 404 })),
  );

  return {
    /** Пропускает придержанную страницу дальше. */
    release: () => openGate?.(),
    /** Сколько раз спросили страницу списка — с учётом повторов. */
    pageRequests: () => playlistCalls,
  };
}

/** Ждёт условия, опрашивая его; без этого пришлось бы угадывать паузу. */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("условие не наступило за отведённое время");
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
  resetQuotaCounter();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("задание выгрузки", () => {
  it("заводится со статусом RUNNING и сразу отдаёт свой id", async () => {
    mockChannel();

    const started = await createRun("https://www.youtube.com/@bigchannel", {
      prisma: testPrisma,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const progress = await jobProgress(started.runId, { prisma: testPrisma });
    expect(progress?.status).toBe("RUNNING");
    expect(progress?.processed).toBe(0);
    // Канал уже сохранён: «канал не найден» пользователь видит сразу,
    // а не после опроса.
    await expect(testPrisma.channel.count()).resolves.toBe(1);
  });

  it("прогресс растёт по мере обработки страниц, а не скачет к итогу", async () => {
    // Вторая страница придержана — состояние «первая сохранена, работа идёт»
    // проверяется точно, а не ловится таймером.
    const { release } = mockChannel({ holdFromPage: 1 });
    const started = await createRun("https://www.youtube.com/@bigchannel", {
      prisma: testPrisma,
    });
    if (!started.ok) throw new Error("не завелось");

    const job = runJob(started.runId, { prisma: testPrisma });

    await waitUntil(async () => {
      const p = await jobProgress(started.runId, { prisma: testPrisma });
      return p !== null && p.processed === 50;
    });

    const midway = await jobProgress(started.runId, { prisma: testPrisma });
    expect(midway?.status).toBe("RUNNING");
    expect(midway?.processed).toBe(50);
    // Оценка объёма берётся из pageInfo.totalResults уже на первой странице.
    expect(midway?.expected).toBe(TOTAL);
    // Строки первой страницы уже в базе, а не ждут конца выгрузки.
    await expect(testPrisma.video.count()).resolves.toBe(50);

    release();
    await job;

    const final = await jobProgress(started.runId, { prisma: testPrisma });
    expect(final?.status).toBe("SUCCEEDED");
    expect(final?.processed).toBe(TOTAL);
    await expect(testPrisma.video.count()).resolves.toBe(TOTAL);
  });

  it("сбой после собранного даёт PARTIAL с причиной и сохранёнными строками", async () => {
    // Первая страница проходит, вторая упирается в квоту.
    mockChannel({ failOnPage: 1 });
    const started = await createRun("https://www.youtube.com/@bigchannel", {
      prisma: testPrisma,
    });
    if (!started.ok) throw new Error("не завелось");

    await runJob(started.runId, { prisma: testPrisma });

    const progress = await jobProgress(started.runId, { prisma: testPrisma });
    expect(progress?.status).toBe("PARTIAL");
    expect(progress?.errorReason).toBe("quota-exceeded");
    expect(progress?.processed).toBe(50);
    // Собранное до сбоя не потеряно.
    await expect(testPrisma.video.count()).resolves.toBe(50);
  });

  it("обрыв связи повторяется ограниченное число раз и даёт частичный результат", async () => {
    // Первая страница прошла, дальше сеть молчит.
    const { pageRequests } = mockChannel({ dropFromPage: 1 });
    const started = await createRun("https://www.youtube.com/@bigchannel", {
      prisma: testPrisma,
    });
    if (!started.ok) throw new Error("не завелось");

    await runJob(started.runId, { prisma: testPrisma });

    const progress = await jobProgress(started.runId, { prisma: testPrisma });
    expect(progress?.status).toBe("PARTIAL");
    expect(progress?.errorReason).toBe("network");
    // Собранное до обрыва осталось в базе.
    expect(progress?.processed).toBe(50);
    await expect(testPrisma.video.count()).resolves.toBe(50);

    // Попыток ровно столько, сколько разрешено: удачная первая страница
    // плюс повторы второй. «Пока не получится» тут не годится — выгрузка
    // идёт при пользователе.
    expect(pageRequests()).toBe(1 + NETWORK_ATTEMPTS);
  });

  it("сбой на первой же странице даёт FAILED", async () => {
    mockChannel({ failOnPage: 0 });
    const started = await createRun("https://www.youtube.com/@bigchannel", {
      prisma: testPrisma,
    });
    if (!started.ok) throw new Error("не завелось");

    await runJob(started.runId, { prisma: testPrisma });

    const progress = await jobProgress(started.runId, { prisma: testPrisma });
    expect(progress?.status).toBe("FAILED");
    expect(progress?.processed).toBe(0);
  });

  it("завершённое задание нельзя завершить повторно", async () => {
    mockChannel();
    const started = await createRun("https://www.youtube.com/@bigchannel", {
      prisma: testPrisma,
    });
    if (!started.ok) throw new Error("не завелось");

    await runJob(started.runId, { prisma: testPrisma });

    // Второй прогон упёрся бы в переход SUCCEEDED → SUCCEEDED.
    await expect(runJob(started.runId, { prisma: testPrisma })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it("прогресс несуществующего задания — null, а не исключение", async () => {
    await expect(jobProgress("нет-такого", { prisma: testPrisma })).resolves.toBeNull();
  });

  it("обе галочки сняты — задание не заводится вовсе", async () => {
    mockChannel();

    const started = await createRun("https://www.youtube.com/@bigchannel", {
      includeVideos: false,
      includeShorts: false,
      prisma: testPrisma,
    });

    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.failure.kind).toBe("no-types");
    await expect(testPrisma.fetchRun.count()).resolves.toBe(0);
  });
});
