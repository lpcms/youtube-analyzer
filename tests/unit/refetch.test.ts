import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { videoPage } from "@/lib/fetch-channel";
import { createRun, isCompleteSweep, runJob } from "@/lib/fetch-job";
import { resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

/**
 * Повторная выгрузка канала.
 *
 * Канал живёт: метрики растут, появляются новые ролики, старые исчезают.
 * Проверяется, что вторая выгрузка обновляет одну и ту же запись канала,
 * заводит свой снимок метрик и не трогает прежний.
 */

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const URL_OF_CHANNEL = "https://www.youtube.com/@channel";

const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

interface Item {
  readonly id: string;
  readonly title: string;
  readonly views: number;
  readonly likes: number;
  readonly short?: boolean;
}

/** Что сейчас лежит на канале. Тест меняет это между выгрузками. */
let catalogue: readonly Item[] = [];

/** Название канала: оно тоже может измениться между выгрузками. */
let channelTitle = "Канал";

/** Роняет запрос страниц, начиная со следующей после указанной. */
let failFromPage: number | null = null;

/** Счётчик страниц — общий на тест, поэтому сбрасывается вместе с уловкой. */
let playlistCalls = 0;

/** Взводит сбой квоты после стольких-то страниц текущей выгрузки. */
function failAfterPages(pages: number): void {
  failFromPage = pages;
  playlistCalls = 0;
}

function item(id: string, over: Partial<Item> = {}): Item {
  return { id, title: `Видео ${id}`, views: 1000, likes: 100, ...over };
}

function mockYouTube(): void {
  server.use(
    http.get(CHANNELS, () =>
      HttpResponse.json({
        items: [
          {
            id: CHANNEL_ID,
            snippet: { title: channelTitle, customUrl: "@channel", thumbnails: {} },
            contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
          },
        ],
      }),
    ),

    http.get(PLAYLIST_ITEMS, ({ request }) => {
      playlistCalls += 1;
      if (failFromPage !== null && playlistCalls > failFromPage) {
        return HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        );
      }

      const params = new globalThis.URL(request.url).searchParams;
      const max = Number(params.get("maxResults") ?? "50");
      const offset = Number(params.get("pageToken") ?? "0");
      const slice = catalogue.slice(offset, offset + max);
      const next = offset + slice.length;

      return HttpResponse.json({
        items: slice.map((v) => ({ contentDetails: { videoId: v.id } })),
        pageInfo: { totalResults: catalogue.length },
        ...(next < catalogue.length ? { nextPageToken: String(next) } : {}),
      });
    }),

    http.get(VIDEOS, ({ request }) => {
      const asked = (new globalThis.URL(request.url).searchParams.get("id") ?? "").split(",");
      return HttpResponse.json({
        items: asked.map((id) => {
          const found = catalogue.find((v) => v.id === id) ?? item(id);
          return {
            id,
            snippet: {
              title: found.title,
              description: "",
              publishedAt: new Date(Date.UTC(2026, 0, 1, 12, 0)).toISOString(),
            },
            contentDetails: { duration: found.short === true ? "PT45S" : "PT10M" },
            statistics: {
              viewCount: String(found.views),
              likeCount: String(found.likes),
              commentCount: "5",
            },
          };
        }),
      });
    }),

    // Страница Shorts отвечает 200 только настоящему Short.
    http.head(SHORTS_PAGE, ({ params }) => {
      const id = String(params["id"]);
      const found = catalogue.find((v) => v.id === id);
      return new HttpResponse(null, { status: found?.short === true ? 200 : 404 });
    }),
  );
}

/** Выгружает канал целиком и дожидается конца. */
async function fetchAll(options: Parameters<typeof createRun>[1] = {}): Promise<string> {
  const started = await createRun(URL_OF_CHANNEL, { prisma: testPrisma, ...options });
  if (!started.ok) throw new Error(`выгрузка не завелась: ${started.failure.kind}`);

  await runJob(started.runId, { prisma: testPrisma, ...options });
  return started.runId;
}

beforeEach(async () => {
  await resetDb();
  catalogue = [];
  channelTitle = "Канал";
  failFromPage = null;
  playlistCalls = 0;
  vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
  resetQuotaCounter();
  vi.spyOn(console, "info").mockImplementation(() => {});
  mockYouTube();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("повторная выгрузка канала", () => {
  it("обновляет запись канала, а не заводит вторую", async () => {
    catalogue = [item("a"), item("b")];
    await fetchAll();

    // Автор переименовал канал между выгрузками.
    channelTitle = "Канал с новым названием";
    await fetchAll();

    const channels = await testPrisma.channel.findMany();
    expect(channels).toHaveLength(1);
    expect(channels[0]?.id).toBe(CHANNEL_ID);
    expect(channels[0]?.title).toBe("Канал с новым названием");
  });

  it("двигает дату последней выгрузки", async () => {
    catalogue = [item("a")];
    await fetchAll();
    const first = (await testPrisma.channel.findUniqueOrThrow({ where: { id: CHANNEL_ID } }))
      .lastFetchedAt;

    await new Promise((r) => setTimeout(r, 5));
    await fetchAll();
    const second = (await testPrisma.channel.findUniqueOrThrow({ where: { id: CHANNEL_ID } }))
      .lastFetchedAt;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it("пишет свежие метрики новым снимком, прежний остаётся", async () => {
    catalogue = [item("a", { views: 1000 })];
    const first = await fetchAll();

    catalogue = [item("a", { views: 5000 })];
    const second = await fetchAll();

    const before = await videoPage(first, { prisma: testPrisma });
    const after = await videoPage(second, { prisma: testPrisma });

    expect(before.rows[0]?.viewCount).toBe(1000);
    expect(after.rows[0]?.viewCount).toBe(5000);
    // Две выгрузки — два снимка одного видео, а не переписанный один.
    await expect(testPrisma.videoStat.count()).resolves.toBe(2);
    await expect(testPrisma.fetchRun.count()).resolves.toBe(2);
  });

  it("добавляет появившиеся видео, не плодя дублей", async () => {
    catalogue = [item("a"), item("b")];
    await fetchAll();

    catalogue = [item("a"), item("b"), item("c")];
    const second = await fetchAll();

    const videos = await testPrisma.video.findMany({ orderBy: { id: "asc" } });
    expect(videos.map((v) => v.id)).toEqual(["a", "b", "c"]);

    const page = await videoPage(second, { prisma: testPrisma });
    expect(page.total).toBe(3);
  });

  it("помечает исчезнувшие видео, а не удаляет их молча", async () => {
    catalogue = [item("a"), item("b"), item("c")];
    const first = await fetchAll();

    // «b» пропало с канала.
    catalogue = [item("a"), item("c")];
    const second = await fetchAll();

    const gone = await testPrisma.video.findUniqueOrThrow({ where: { id: "b" } });
    expect(gone.goneAt).not.toBeNull();

    const alive = await testPrisma.video.findMany({ where: { goneAt: null } });
    expect(alive.map((v) => v.id).sort()).toEqual(["a", "c"]);

    // Строка цела, и прошлый снимок вместе с ней: история не теряется.
    const before = await videoPage(first, { prisma: testPrisma });
    expect(before.total).toBe(3);

    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: second } });
    expect(run.vanishedCount).toBe(1);
  });

  it("дата исчезновения ставится один раз, а не обновляется каждой выгрузкой", async () => {
    catalogue = [item("a"), item("b")];
    await fetchAll();

    catalogue = [item("a")];
    await fetchAll();
    const firstMark = (await testPrisma.video.findUniqueOrThrow({ where: { id: "b" } })).goneAt;

    await new Promise((r) => setTimeout(r, 5));
    await fetchAll();
    const secondMark = (await testPrisma.video.findUniqueOrThrow({ where: { id: "b" } })).goneAt;

    // Нужна дата, когда видео пропало, а не когда его в последний раз не нашли.
    expect(secondMark?.getTime()).toBe(firstMark?.getTime());
    // И второй выгрузке засчитывать эту пропажу заново незачем.
    const runs = await testPrisma.fetchRun.findMany({ orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => r.vanishedCount)).toEqual([0, 1, 0]);
  });

  it("вернувшееся видео перестаёт считаться исчезнувшим", async () => {
    catalogue = [item("a"), item("b")];
    await fetchAll();

    catalogue = [item("a")];
    await fetchAll();
    expect(
      (await testPrisma.video.findUniqueOrThrow({ where: { id: "b" } })).goneAt,
    ).not.toBeNull();

    // Автор вернул ролик из черновиков.
    catalogue = [item("a"), item("b")];
    await fetchAll();

    expect((await testPrisma.video.findUniqueOrThrow({ where: { id: "b" } })).goneAt).toBeNull();
  });

  it("таблица по умолчанию показывает последний снимок", async () => {
    catalogue = [item("a", { views: 100 }), item("b", { views: 200 })];
    await fetchAll();

    catalogue = [item("a", { views: 999 }), item("b", { views: 888 })];
    const second = await fetchAll();

    const latest = await testPrisma.fetchRun.findFirstOrThrow({
      where: { channelId: CHANNEL_ID },
      orderBy: { startedAt: "desc" },
    });
    expect(latest.id).toBe(second);

    const page = await videoPage(latest.id, { prisma: testPrisma });
    expect(page.rows.map((r) => r.viewCount).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([
      888, 999,
    ]);
  });

  it("вирусность пересчитывается по обновлённой выгрузке целиком", async () => {
    // В первой выгрузке «a» — заурядное видео на фоне «b».
    catalogue = [
      item("a", { views: 1000, likes: 10 }),
      item("b", { views: 1000, likes: 300 }),
      item("c", { views: 1000, likes: 100 }),
    ];
    const first = await fetchAll();

    // Во второй «a» взлетело.
    catalogue = [
      item("a", { views: 50_000, likes: 9000 }),
      item("b", { views: 1000, likes: 300 }),
      item("c", { views: 1000, likes: 100 }),
    ];
    const second = await fetchAll();

    const scoreOf = async (runId: string, videoId: string): Promise<number | null> => {
      const stat = await testPrisma.videoStat.findFirstOrThrow({
        where: { fetchRunId: runId, videoId },
      });
      return stat.viralityScore;
    };

    const before = await scoreOf(first, "a");
    const after = await scoreOf(second, "a");

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(before!);

    // Прежний снимок не переписан: он остаётся тем, чем был в свой день.
    expect(await scoreOf(first, "b")).toBeGreaterThan(before!);
  });
});

describe("когда пропажу засчитывать нельзя", () => {
  it("выгрузка с ограничением по количеству никого не хоронит", async () => {
    catalogue = [item("a"), item("b"), item("c")];
    await fetchAll();

    // Просим только одно видео: остальные не запрашивались, а не исчезли.
    catalogue = [item("a"), item("b"), item("c")];
    const limited = await fetchAll({ limit: 1 });

    await expect(testPrisma.video.count({ where: { goneAt: { not: null } } })).resolves.toBe(0);
    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: limited } });
    expect(run.vanishedCount).toBe(0);
  });

  it("выгрузка одного типа не хоронит видео другого типа", async () => {
    catalogue = [item("a"), item("s", { short: true })];
    await fetchAll();

    // Только Video: Shorts в этой выгрузке не искали.
    await fetchAll({ includeShorts: false });

    expect((await testPrisma.video.findUniqueOrThrow({ where: { id: "s" } })).goneAt).toBeNull();
  });

  it("прерванная выгрузка не хоронит недосмотренное", async () => {
    catalogue = Array.from({ length: 120 }, (_, i) => item(`v${i}`));
    await fetchAll();

    // Квота кончается после первой страницы — остальные видео просто
    // не дошли до нас.
    failAfterPages(1);
    const partial = await fetchAll();

    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: partial } });
    expect(run.status).toBe("PARTIAL");
    expect(run.vanishedCount).toBe(0);
    await expect(testPrisma.video.count({ where: { goneAt: { not: null } } })).resolves.toBe(0);
  });
});

describe("признак полного обхода", () => {
  const full = { requestedLimit: null, includeVideos: true, includeShorts: true };

  it("полный обход без сбоя — единственный случай, когда пропажа засчитывается", () => {
    expect(isCompleteSweep(full, null)).toBe(true);
  });

  it("сбой отменяет признак", () => {
    expect(isCompleteSweep(full, "quota-exceeded")).toBe(false);
  });

  it("ограничение по количеству отменяет признак", () => {
    expect(isCompleteSweep({ ...full, requestedLimit: 10 }, null)).toBe(false);
  });

  it("снятый тип отменяет признак", () => {
    expect(isCompleteSweep({ ...full, includeShorts: false }, null)).toBe(false);
    expect(isCompleteSweep({ ...full, includeVideos: false }, null)).toBe(false);
  });
});

describe("две выгрузки одного канала разом", () => {
  it("не падают на вставке одного и того же видео", async () => {
    catalogue = [item("a"), item("b"), item("c")];

    const first = await createRun(URL_OF_CHANNEL, { prisma: testPrisma });
    const second = await createRun(URL_OF_CHANNEL, { prisma: testPrisma });
    if (!first.ok || !second.ok) throw new Error("выгрузка не завелась");

    // upsert в SQLite не атомарен: обе выгрузки успевают не найти видео
    // и обе пытаются его вставить.
    await Promise.all([
      runJob(first.runId, { prisma: testPrisma }),
      runJob(second.runId, { prisma: testPrisma }),
    ]);

    const runs = await testPrisma.fetchRun.findMany();
    expect(runs.map((r) => r.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);

    // Ни дублей видео, ни потерянных снимков.
    await expect(testPrisma.video.count()).resolves.toBe(3);
    await expect(testPrisma.videoStat.count()).resolves.toBe(6);
    await expect(testPrisma.video.count({ where: { goneAt: { not: null } } })).resolves.toBe(0);
  });
});
