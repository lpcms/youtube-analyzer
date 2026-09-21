import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChannel } from "@/lib/fetch-channel";
import { resetQuotaCounter } from "@/lib/youtube/api";
import {
  fetchChannelVideos,
  matchesSelection,
  selectVideos,
  type FetchedVideo,
} from "@/lib/youtube/videos";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

const BOTH = { includeVideos: true, includeShorts: true };

function fake(id: string, kind: "VIDEO" | "SHORTS"): FetchedVideo {
  return {
    id,
    title: "",
    description: "",
    publishedAt: new Date(Date.UTC(2026, 8, 21)),
    durationSec: kind === "SHORTS" ? 45 : 900,
    kind,
    kindAssumed: false,
    viewCount: 1,
    likeCount: 1,
    commentCount: 1,
  };
}

describe("отбор по типам", () => {
  const mixed = [
    fake("a", "VIDEO"),
    fake("b", "SHORTS"),
    fake("c", "VIDEO"),
    fake("d", "SHORTS"),
    fake("e", "SHORTS"),
  ];

  it("оба типа оставляют всё", () => {
    expect(selectVideos(mixed, { limit: null, ...BOTH })).toHaveLength(5);
  });

  it("только Shorts", () => {
    const result = selectVideos(mixed, {
      limit: null,
      includeVideos: false,
      includeShorts: true,
    });

    expect(result.map((v) => v.id)).toEqual(["b", "d", "e"]);
  });

  it("только Video", () => {
    const result = selectVideos(mixed, {
      limit: null,
      includeVideos: true,
      includeShorts: false,
    });

    expect(result.map((v) => v.id)).toEqual(["a", "c"]);
  });

  it("обе галочки сняты — не подходит ничего", () => {
    const selection = { includeVideos: false, includeShorts: false };

    expect(matchesSelection(fake("a", "VIDEO"), selection)).toBe(false);
    expect(matchesSelection(fake("b", "SHORTS"), selection)).toBe(false);
    expect(selectVideos(mixed, { limit: null, ...selection })).toEqual([]);
  });

  it("берёт ровно N подходящих, если их хватает", () => {
    const result = selectVideos(mixed, {
      limit: 2,
      includeVideos: false,
      includeShorts: true,
    });

    expect(result.map((v) => v.id)).toEqual(["b", "d"]);
  });

  it("если подходящих меньше N, возвращает все имеющиеся и не добирает чужими", () => {
    const result = selectVideos(mixed, {
      limit: 10,
      includeVideos: true,
      includeShorts: false,
    });

    expect(result.map((v) => v.id)).toEqual(["a", "c"]);
  });
});

/** Канал: 200 видео, каждое пятое — Shorts, значит Shorts всего 40. */
const TOTAL = 200;
const ids = Array.from({ length: TOTAL }, (_, i) =>
  ("v" + String(i).padStart(10, "0")).slice(0, 11),
);
const isShort = (i: number) => i % 5 === 4;

interface Calls {
  playlistPages: number;
  videosBatches: number;
}

function mockChannel(calls: Calls) {
  server.use(
    http.get(CHANNELS, () =>
      HttpResponse.json({
        items: [
          {
            id: CHANNEL_ID,
            snippet: { title: "Канал", customUrl: "@c", thumbnails: {} },
            contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
          },
        ],
      }),
    ),

    http.get(PLAYLIST_ITEMS, ({ request }) => {
      calls.playlistPages += 1;
      const params = new URL(request.url).searchParams;
      const max = Number(params.get("maxResults") ?? "50");
      const offset = Number(params.get("pageToken") ?? "0");
      const slice = ids.slice(offset, offset + max);
      const next = offset + slice.length;

      return HttpResponse.json({
        items: slice.map((id) => ({ contentDetails: { videoId: id } })),
        ...(next < ids.length ? { nextPageToken: String(next) } : {}),
      });
    }),

    http.get(VIDEOS, ({ request }) => {
      calls.videosBatches += 1;
      const requested = (new URL(request.url).searchParams.get("id") ?? "").split(",");
      return HttpResponse.json({
        items: requested.map((id) => {
          const i = ids.indexOf(id);
          return {
            id,
            snippet: {
              title: "",
              description: "",
              publishedAt: new Date(Date.UTC(2026, 0, 1 + i, 12, 0)).toISOString(),
            },
            contentDetails: { duration: isShort(i) ? "PT45S" : "PT10M" },
            statistics: { viewCount: "100", likeCount: "10", commentCount: "1" },
          };
        }),
      });
    }),

    http.head(SHORTS_PAGE, ({ params }) => {
      const i = ids.indexOf(String(params["id"]));
      return new HttpResponse(null, { status: i >= 0 && isShort(i) ? 200 : 303 });
    }),
  );
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

describe("выгрузка останавливается, набрав нужное", () => {
  it("запрос 5 видео обоих типов берёт одну страницу из пяти", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    const videos = await fetchChannelVideos(UPLOADS, { limit: 5, ...BOTH });

    expect(videos).toHaveLength(5);
    expect(calls.playlistPages).toBe(1);
    // Когда подходит всё подряд, просить у API больше остатка незачем.
    expect(calls.videosBatches).toBe(1);
  });

  it("запрос 10 Shorts не обходит канал дальше, чем нужно", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    const videos = await fetchChannelVideos(UPLOADS, {
      limit: 10,
      includeVideos: false,
      includeShorts: true,
    });

    expect(videos).toHaveLength(10);
    expect(videos.every((v) => v.kind === "SHORTS")).toBe(true);
    // Каждое пятое видео — Shorts, значит 10 штук набираются на первой
    // полусотне. Остальные 150 видео канала не трогаются вовсе.
    expect(calls.playlistPages).toBe(1);
  });

  it("если подходящих меньше запрошенного, обходит канал целиком и отдаёт все", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    const videos = await fetchChannelVideos(UPLOADS, {
      limit: 100,
      includeVideos: false,
      includeShorts: true,
    });

    // Shorts всего 40 — больше взять неоткуда.
    expect(videos).toHaveLength(40);
    expect(calls.playlistPages).toBe(4);
  });

  it("обе галочки сняты — ни одного обращения к API", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    const videos = await fetchChannelVideos(UPLOADS, {
      limit: 10,
      includeVideos: false,
      includeShorts: false,
    });

    expect(videos).toEqual([]);
    expect(calls.playlistPages).toBe(0);
  });
});

describe("выгрузка канала с отбором", () => {
  it("запрос 50 Shorts при снятой галочке Video даёт 50 строк типа Shorts", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    const result = await fetchChannel("https://www.youtube.com/@bigchannel", {
      limit: 50,
      includeVideos: false,
      includeShorts: true,
      prisma: testPrisma,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const saved = await testPrisma.video.findMany();
    // Shorts на канале всего 40 — значит, сохраняются все имеющиеся.
    expect(saved).toHaveLength(40);
    expect(saved.every((v) => v.kind === "SHORTS")).toBe(true);
  });

  it("снятая галочка Shorts оставляет только Video", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    await fetchChannel("https://www.youtube.com/@bigchannel", {
      limit: 12,
      includeVideos: true,
      includeShorts: false,
      prisma: testPrisma,
    });

    const saved = await testPrisma.video.findMany();
    expect(saved).toHaveLength(12);
    expect(saved.every((v) => v.kind === "VIDEO")).toBe(true);
  });

  it("выбранные типы записываются в журнал выгрузки", async () => {
    const calls: Calls = { playlistPages: 0, videosBatches: 0 };
    mockChannel(calls);

    const result = await fetchChannel("https://www.youtube.com/@bigchannel", {
      limit: 5,
      includeVideos: false,
      includeShorts: true,
      prisma: testPrisma,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const run = await testPrisma.fetchRun.findUnique({ where: { id: result.fetchRunId } });
    expect(run?.requestedLimit).toBe(5);
    expect(run?.includeVideos).toBe(false);
    expect(run?.includeShorts).toBe(true);
  });
});
