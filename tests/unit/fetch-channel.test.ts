import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChannel, videoRows } from "@/lib/fetch-channel";
import { resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SEARCH = "https://www.googleapis.com/youtube/v3/search";

/** Идентификатор видео фиксированной длины 11 символов. */
function videoId(i: number): string {
  return ("vid" + String(i).padStart(8, "0")).slice(0, 11);
}

function channelResponse() {
  return {
    items: [
      {
        id: CHANNEL_ID,
        snippet: { title: "MrBeast", customUrl: "@mrbeast", thumbnails: {} },
        contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
      },
    ],
  };
}

/** `count` видео: у второго скрыты лайки, у третьего нулевые просмотры. */
function videosResponse(ids: readonly string[]) {
  return {
    items: ids.map((id, i) => ({
      id,
      snippet: {
        title: "Видео " + String(i),
        description: i === 0 ? "описание" : "",
        publishedAt: new Date(Date.UTC(2026, 8, 21 - i, 12, 0)).toISOString(),
      },
      contentDetails: { duration: i % 2 === 0 ? "PT10M" : "PT45S" },
      statistics: {
        viewCount: String(1000 * (i + 1)),
        // Второе видео — со скрытыми лайками: поля просто нет.
        ...(i === 1 ? {} : { likeCount: String(10 * (i + 1)) }),
        commentCount: String(i),
      },
    })),
  };
}

function mockChannelWithVideos(count: number) {
  const ids = Array.from({ length: count }, (_, i) => videoId(i));
  server.use(
    http.get(CHANNELS, () => HttpResponse.json(channelResponse())),
    http.get(PLAYLIST_ITEMS, () =>
      HttpResponse.json({ items: ids.map((id) => ({ contentDetails: { videoId: id } })) }),
    ),
    http.get(VIDEOS, ({ request }) => {
      const requested = new URL(request.url).searchParams.get("id")?.split(",") ?? [];
      return HttpResponse.json(videosResponse(requested));
    }),
  );
  return ids;
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

describe("выгрузка канала", () => {
  it("пишет 10 строк в БД на замоканном API", async () => {
    mockChannelWithVideos(10);

    const result = await fetchChannel("https://www.youtube.com/@MrBeast", {
      prisma: testPrisma,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(testPrisma.video.count()).resolves.toBe(10);
    await expect(
      testPrisma.videoStat.count({ where: { fetchRunId: result.fetchRunId } }),
    ).resolves.toBe(10);

    const channel = await testPrisma.channel.findUnique({ where: { id: CHANNEL_ID } });
    expect(channel?.title).toBe("MrBeast");
    expect(channel?.uploadsPlaylistId).toBe(UPLOADS);
    expect(channel?.lastFetchedAt).not.toBeNull();
  });

  it("не вызывает search.list для перебора видео", async () => {
    let searchCalled = false;
    mockChannelWithVideos(10);
    server.use(
      http.get(SEARCH, () => {
        searchCalled = true;
        return HttpResponse.json({ items: [] });
      }),
    );

    await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });

    expect(searchCalled).toBe(false);
  });

  it("берёт ровно запрошенное число видео, если на канале их больше", async () => {
    mockChannelWithVideos(25);

    const result = await fetchChannel("https://www.youtube.com/@MrBeast", {
      limit: 10,
      prisma: testPrisma,
    });

    expect(result.ok).toBe(true);
    await expect(testPrisma.video.count()).resolves.toBe(10);
  });

  it("сохраняет скрытую статистику как null, а не ноль", async () => {
    mockChannelWithVideos(3);

    const result = await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stats = await testPrisma.videoStat.findMany({
      where: { fetchRunId: result.fetchRunId },
      orderBy: { videoId: "asc" },
    });

    // У второго видео лайков нет вовсе — это null.
    expect(stats[1]?.likeCount).toBeNull();
    expect(stats[0]?.likeCount).toBe(10);
    // Нулевой счётчик комментариев у первого — настоящий ноль, не null.
    expect(stats[0]?.commentCount).toBe(0);
  });

  it("заводит выгрузку со статусом SUCCEEDED и числом обработанных", async () => {
    mockChannelWithVideos(4);

    const result = await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const run = await testPrisma.fetchRun.findUnique({ where: { id: result.fetchRunId } });
    expect(run?.status).toBe("SUCCEEDED");
    expect(run?.processedCount).toBe(4);
    expect(run?.channelId).toBe(CHANNEL_ID);
  });

  it("повторная выгрузка добавляет снимок, не плодя видео", async () => {
    mockChannelWithVideos(5);

    const first = await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });
    const second = await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });

    expect(first.ok && second.ok).toBe(true);
    await expect(testPrisma.video.count()).resolves.toBe(5);
    await expect(testPrisma.fetchRun.count()).resolves.toBe(2);
    // Два снимка на каждое видео — ряд наблюдений.
    await expect(testPrisma.videoStat.count()).resolves.toBe(10);
  });

  it("чужой домен не доходит до API и не пишет в БД", async () => {
    const result = await fetchChannel("https://vimeo.com/@MrBeast", { prisma: testPrisma });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid-url");
    await expect(testPrisma.channel.count()).resolves.toBe(0);
  });

  it("несуществующий канал даёт not-found, а не исключение", async () => {
    server.use(http.get(CHANNELS, () => HttpResponse.json({ items: [] })));

    const result = await fetchChannel("https://www.youtube.com/@nobody", { prisma: testPrisma });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
  });

  it("исчерпанная квота возвращается ошибкой, а не бросается наружу", async () => {
    server.use(
      http.get(CHANNELS, () => HttpResponse.json(channelResponse())),
      http.get(PLAYLIST_ITEMS, () =>
        HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        ),
      ),
    );

    const result = await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "api") {
      expect(result.error.reason).toBe("quota-exceeded");
    }
  });
});

describe("строки таблицы", () => {
  it("читаются из БД и отсортированы по дате публикации убыванием", async () => {
    mockChannelWithVideos(3);

    const result = await fetchChannel("https://www.youtube.com/@MrBeast", { prisma: testPrisma });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await videoRows(result.fetchRunId, { prisma: testPrisma });

    expect(rows).toHaveLength(3);
    const dates = rows.map((r) => r.publishedAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(rows[0]?.viewCount).toBe(1000);
  });
});
