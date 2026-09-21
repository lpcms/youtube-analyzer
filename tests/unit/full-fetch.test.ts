import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChannel } from "@/lib/fetch-channel";
import { QUOTA_COST, quotaSpent, resetQuotaCounter } from "@/lib/youtube/api";
import { fetchUploadIds } from "@/lib/youtube/videos";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

/** Канал из 137 видео — три страницы: 50 + 50 + 37. */
const TOTAL = 137;

function videoId(i: number): string {
  return ("v" + String(i).padStart(10, "0")).slice(0, 11);
}

const allIds = Array.from({ length: TOTAL }, (_, i) => videoId(i));

/** Счётчики обращений, чтобы проверять не результат, а способ его получения. */
interface Calls {
  playlistPages: number;
  videosBatches: number;
  batchSizes: number[];
}

function mockChannel(calls: Calls, total = TOTAL) {
  const ids = allIds.slice(0, total);

  server.use(
    http.get(CHANNELS, () =>
      HttpResponse.json({
        items: [
          {
            id: CHANNEL_ID,
            snippet: { title: "Большой канал", customUrl: "@big", thumbnails: {} },
            contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
          },
        ],
      }),
    ),

    http.get(PLAYLIST_ITEMS, ({ request }) => {
      calls.playlistPages += 1;
      const params = new URL(request.url).searchParams;
      const maxResults = Number(params.get("maxResults") ?? "50");
      const offset = Number(params.get("pageToken") ?? "0");
      const slice = ids.slice(offset, offset + maxResults);
      const next = offset + slice.length;

      return HttpResponse.json({
        items: slice.map((id) => ({ contentDetails: { videoId: id } })),
        // Токен есть, пока плейлист не кончился.
        ...(next < ids.length ? { nextPageToken: String(next) } : {}),
      });
    }),

    http.get(VIDEOS, ({ request }) => {
      const requested = (new URL(request.url).searchParams.get("id") ?? "").split(",");
      calls.videosBatches += 1;
      calls.batchSizes.push(requested.length);

      return HttpResponse.json({
        items: requested.map((id) => ({
          id,
          snippet: {
            title: "Видео " + id,
            description: "",
            publishedAt: new Date(Date.UTC(2026, 0, 1 + allIds.indexOf(id), 12, 0)).toISOString(),
          },
          // Все длинные: подтверждение Shorts здесь не предмет проверки.
          contentDetails: { duration: "PT10M" },
          statistics: { viewCount: "100", likeCount: "10", commentCount: "1" },
        })),
      });
    }),

    http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 404 })),
  );
}

function freshCalls(): Calls {
  return { playlistPages: 0, videosBatches: 0, batchSizes: [] };
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

describe("постраничный обход плейлиста загрузок", () => {
  it("признак «все видео» проходит плейлист до конца", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    const ids = await fetchUploadIds(UPLOADS, null);

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(calls.playlistPages).toBe(3);
  });

  it("заданное число останавливает обход досрочно", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    const ids = await fetchUploadIds(UPLOADS, 60);

    expect(ids).toHaveLength(60);
    // 50 за первую страницу, 10 за вторую — третья не запрашивается.
    expect(calls.playlistPages).toBe(2);
  });

  it("канал без видео не зацикливает обход", async () => {
    const calls = freshCalls();
    mockChannel(calls, 0);

    const ids = await fetchUploadIds(UPLOADS, null);

    expect(ids).toEqual([]);
    expect(calls.playlistPages).toBe(1);
  });
});

describe("выгрузка канала целиком", () => {
  it("канал из 137 видео даёт 137 строк без дублей и пропусков", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    const result = await fetchChannel("https://www.youtube.com/@big", {
      limit: null,
      prisma: testPrisma,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(testPrisma.video.count()).resolves.toBe(TOTAL);

    const saved = await testPrisma.video.findMany({ select: { id: true } });
    expect(new Set(saved.map((v) => v.id)).size).toBe(TOTAL);
    // Ни одного пропуска: сохранённое множество совпадает с исходным.
    expect(new Set(saved.map((v) => v.id))).toEqual(new Set(allIds));

    await expect(
      testPrisma.videoStat.count({ where: { fetchRunId: result.fetchRunId } }),
    ).resolves.toBe(TOTAL);
  });

  it("метрики запрашиваются пакетами по 50", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    await fetchChannel("https://www.youtube.com/@big", { limit: null, prisma: testPrisma });

    expect(calls.videosBatches).toBe(3);
    expect(calls.batchSizes).toEqual([50, 50, 37]);
  });

  it("весь канал из 137 видео стоит 7 единиц квоты", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    await fetchChannel("https://www.youtube.com/@big", { limit: null, prisma: testPrisma });

    // 1 за разрешение канала, 3 страницы плейлиста, 3 пакета метрик.
    const expected =
      QUOTA_COST["channels.list"] +
      3 * QUOTA_COST["playlistItems.list"] +
      3 * QUOTA_COST["videos.list"];
    expect(quotaSpent()).toBe(expected);
    expect(expected).toBe(7);
  });

  it("повторная выгрузка не плодит дубли видео, но добавляет снимок", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    await fetchChannel("https://www.youtube.com/@big", { limit: null, prisma: testPrisma });
    await fetchChannel("https://www.youtube.com/@big", { limit: null, prisma: testPrisma });

    await expect(testPrisma.video.count()).resolves.toBe(TOTAL);
    await expect(testPrisma.fetchRun.count()).resolves.toBe(2);
    await expect(testPrisma.videoStat.count()).resolves.toBe(TOTAL * 2);
  });

  it("выгрузка записывает «все» как отсутствие предела", async () => {
    const calls = freshCalls();
    mockChannel(calls);

    const result = await fetchChannel("https://www.youtube.com/@big", {
      limit: null,
      prisma: testPrisma,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const run = await testPrisma.fetchRun.findUnique({ where: { id: result.fetchRunId } });
    // null отличает «все» от «много»: в журнале это разные намерения.
    expect(run?.requestedLimit).toBeNull();
    expect(run?.processedCount).toBe(TOTAL);
  });
});
