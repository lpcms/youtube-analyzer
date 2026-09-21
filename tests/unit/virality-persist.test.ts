import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { videoRows } from "@/lib/fetch-channel";
import { createRun, runJob } from "@/lib/fetch-job";
import { resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

/**
 * Пять длинных видео с теми же числами, что в модульном тесте формулы:
 * среднее по обоим показателям должно получить ровно 10,0.
 */
const FIXTURES = [
  { views: 1000, likes: 10, comments: 0, expected: 4 },
  { views: 1000, likes: 20, comments: 5, expected: 8 },
  { views: 2000, likes: 40, comments: 10, expected: 10 },
  { views: 3000, likes: 90, comments: 15, expected: 14 },
  { views: 5000, likes: 100, comments: 25, expected: 16 },
];

const ids = FIXTURES.map((_, i) => ("v" + String(i).padStart(10, "0")).slice(0, 11));

function mockChannel(options: { hideLikesAt?: number } = {}) {
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

    http.get(PLAYLIST_ITEMS, () =>
      HttpResponse.json({
        items: ids.map((id) => ({ contentDetails: { videoId: id } })),
        pageInfo: { totalResults: ids.length },
      }),
    ),

    http.get(VIDEOS, ({ request }) => {
      const requested = (new URL(request.url).searchParams.get("id") ?? "").split(",");
      return HttpResponse.json({
        items: requested.map((id) => {
          const i = ids.indexOf(id);
          const f = FIXTURES[i]!;
          return {
            id,
            snippet: {
              title: "Видео " + String(i),
              description: "",
              publishedAt: new Date(Date.UTC(2026, 0, 1 + i, 12, 0)).toISOString(),
            },
            contentDetails: { duration: "PT10M" },
            statistics: {
              viewCount: String(f.views),
              ...(options.hideLikesAt === i ? {} : { likeCount: String(f.likes) }),
              commentCount: String(f.comments),
            },
          };
        }),
      });
    }),

    http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 404 })),
  );
}

async function runFetch(): Promise<string> {
  const started = await createRun("https://www.youtube.com/@bigchannel", { prisma: testPrisma });
  if (!started.ok) throw new Error("задание не завелось");
  await runJob(started.runId, { prisma: testPrisma });
  return started.runId;
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

describe("вирусность после выгрузки", () => {
  it("значения сохранены в снимках и совпадают с посчитанными вручную", async () => {
    mockChannel();
    const runId = await runFetch();

    const stats = await testPrisma.videoStat.findMany({
      where: { fetchRunId: runId },
      orderBy: { videoId: "asc" },
    });

    expect(stats).toHaveLength(FIXTURES.length);
    expect(stats.map((s) => s.viralityScore)).toEqual(FIXTURES.map((f) => f.expected));
  });

  it("медианное видео получает ровно 10,0", async () => {
    mockChannel();
    const runId = await runFetch();

    const rows = await videoRows(runId, { prisma: testPrisma });
    const median = rows.find((r) => r.viewCount === 2000);

    expect(median?.viralityScore).toBeCloseTo(10.0, 1);
  });

  it("видео со скрытыми лайками остаётся без оценки", async () => {
    mockChannel({ hideLikesAt: 0 });
    const runId = await runFetch();

    const rows = await videoRows(runId, { prisma: testPrisma });
    const hidden = rows.find((r) => r.likeCount === null);
    const rest = rows.filter((r) => r.likeCount !== null);

    expect(hidden?.viralityScore).toBeNull();
    // Остальные посчитаны — одно «н/д» не обнуляет всю колонку.
    expect(rest.every((r) => r.viralityScore !== null)).toBe(true);
  });

  it("вторая выгрузка считает вирусность заново, не трогая прежний снимок", async () => {
    mockChannel();
    const first = await runFetch();
    const second = await runFetch();

    const firstScores = await testPrisma.videoStat.findMany({
      where: { fetchRunId: first },
      orderBy: { videoId: "asc" },
    });
    const secondScores = await testPrisma.videoStat.findMany({
      where: { fetchRunId: second },
      orderBy: { videoId: "asc" },
    });

    expect(firstScores.map((s) => s.viralityScore)).toEqual(FIXTURES.map((f) => f.expected));
    expect(secondScores.map((s) => s.viralityScore)).toEqual(FIXTURES.map((f) => f.expected));
    // Это два разных набора строк, а не переписанный один.
    expect(firstScores[0]?.id).not.toBe(secondScores[0]?.id);
  });

  it("расчёт идёт один раз при выгрузке, а не при каждом чтении таблицы", async () => {
    mockChannel();
    const runId = await runFetch();

    // Значение уже лежит в БД: чтение строк ничего не считает.
    const raw = await testPrisma.videoStat.findFirst({
      where: { fetchRunId: runId },
      orderBy: { videoId: "asc" },
    });
    expect(raw?.viralityScore).toBe(FIXTURES[0]!.expected);

    const before = await videoRows(runId, { prisma: testPrisma });
    const after = await videoRows(runId, { prisma: testPrisma });
    expect(after.map((r) => r.viralityScore)).toEqual(before.map((r) => r.viralityScore));
  });
});
