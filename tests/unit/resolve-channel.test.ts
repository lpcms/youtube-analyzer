import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTA_COST, YouTubeApiError, quotaSpent, resetQuotaCounter } from "@/lib/youtube/api";
import { resolveChannel } from "@/lib/youtube/resolve-channel";
import { server } from "../msw/server";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const SEARCH = "https://www.googleapis.com/youtube/v3/search";

/** Ответ channels.list с одним каналом. */
function channelItem() {
  return {
    items: [
      {
        id: CHANNEL_ID,
        snippet: {
          title: "MrBeast",
          customUrl: "@mrbeast",
          thumbnails: {
            default: { url: "https://example.test/s.jpg" },
            high: { url: "https://example.test/l.jpg" },
          },
        },
        contentDetails: { relatedPlaylists: { uploads: "UUX6OQ3DkcsbYNE6H8uQQuVA" } },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
  resetQuotaCounter();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("разрешение канала", () => {
  it("@handle разрешается в идентификатор канала", async () => {
    let seenParams: URLSearchParams | null = null;
    server.use(
      http.get(CHANNELS, ({ request }) => {
        seenParams = new URL(request.url).searchParams;
        return HttpResponse.json(channelItem());
      }),
    );

    const result = await resolveChannel("https://www.youtube.com/@MrBeast/videos");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.channel.id).toBe(CHANNEL_ID);
    expect(result.channel.title).toBe("MrBeast");
    expect(result.channel.handle).toBe("@mrbeast");
    expect(result.channel.uploadsPlaylistId).toBe("UUX6OQ3DkcsbYNE6H8uQQuVA");
    // Хэндл уходит в API с собачкой — без неё канал не находится.
    expect(seenParams!.get("forHandle")).toBe("@MrBeast");
  });

  it("берёт аватар покрупнее из доступных", async () => {
    server.use(http.get(CHANNELS, () => HttpResponse.json(channelItem())));

    const result = await resolveChannel(`https://www.youtube.com/channel/${CHANNEL_ID}`);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channel.thumbnailUrl).toBe("https://example.test/l.jpg");
  });

  it("несуществующий канал даёт «канал не найден», а не исключение", async () => {
    // YouTube отвечает 200 с пустым items, а не ошибкой.
    server.use(http.get(CHANNELS, () => HttpResponse.json({ items: [] })));

    const result = await resolveChannel("https://www.youtube.com/@no-such-channel-here");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("not-found");
  });

  it("чужой домен отклоняется до обращения к API", async () => {
    // Обработчиков нет вовсе: если запрос уйдёт, MSW уронит тест.
    const result = await resolveChannel("https://vimeo.com/@MrBeast");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("invalid-url");
      if (result.failure.reason === "invalid-url") {
        expect(result.failure.detail).toBe("foreign-host");
      }
    }
    expect(quotaSpent()).toBe(0);
  });

  it("/user/Name разрешается через forUsername", async () => {
    let seenParams: URLSearchParams | null = null;
    server.use(
      http.get(CHANNELS, ({ request }) => {
        seenParams = new URL(request.url).searchParams;
        return HttpResponse.json(channelItem());
      }),
    );

    const result = await resolveChannel("https://www.youtube.com/user/PewDiePie");

    expect(result.ok).toBe(true);
    expect(seenParams!.get("forUsername")).toBe("PewDiePie");
  });
});

describe("расход квоты", () => {
  it("разрешение по хэндлу стоит одну единицу", async () => {
    server.use(http.get(CHANNELS, () => HttpResponse.json(channelItem())));

    await resolveChannel("https://www.youtube.com/@MrBeast");

    expect(quotaSpent()).toBe(QUOTA_COST["channels.list"]);
  });

  it("/c/Name уходит в search.list и стоит 101 единицу", async () => {
    server.use(
      http.get(SEARCH, () => HttpResponse.json({ items: [{ id: { channelId: CHANNEL_ID } }] })),
      http.get(CHANNELS, () => HttpResponse.json(channelItem())),
    );

    const result = await resolveChannel("https://www.youtube.com/c/PewDiePie");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channel.id).toBe(CHANNEL_ID);
    // 100 за поиск плюс 1 за разрешение найденного идентификатора.
    expect(quotaSpent()).toBe(QUOTA_COST["search.list"] + QUOTA_COST["channels.list"]);
  });

  it("дорогой вызов виден в логе с ценой в единицах квоты", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    server.use(
      http.get(SEARCH, () => HttpResponse.json({ items: [{ id: { channelId: CHANNEL_ID } }] })),
      http.get(CHANNELS, () => HttpResponse.json(channelItem())),
    );

    await resolveChannel("https://www.youtube.com/c/PewDiePie");

    const lines = info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("search.list") && l.includes("100 ед. квоты"))).toBe(true);
    expect(lines.some((l) => l.includes("дорогой вызов"))).toBe(true);
  });

  it("поиск, не нашедший канала, даёт «канал не найден»", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ items: [] })));

    const result = await resolveChannel("https://www.youtube.com/c/NoSuchName");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("not-found");
  });
});

describe("ошибки API", () => {
  it("исчерпанная квота отличается от прочих ошибок", async () => {
    server.use(
      http.get(CHANNELS, () =>
        HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        ),
      ),
    );

    await expect(resolveChannel("https://www.youtube.com/@MrBeast")).rejects.toMatchObject({
      kind: "quota-exceeded",
    });
  });

  it("отсутствие ключа — отдельная ошибка, а не поход в сеть", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");

    await expect(resolveChannel("https://www.youtube.com/@MrBeast")).rejects.toBeInstanceOf(
      YouTubeApiError,
    );
  });

  it("текст ошибки не содержит ключ API", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "СЕКРЕТНЫЙ-КЛЮЧ");
    server.use(
      http.get(CHANNELS, () =>
        HttpResponse.json(
          { error: { message: "keyInvalid", errors: [{ reason: "keyInvalid" }] } },
          { status: 400 },
        ),
      ),
    );

    await expect(resolveChannel("https://www.youtube.com/@MrBeast")).rejects.toSatisfy(
      (e: unknown) => !String((e as Error).message).includes("СЕКРЕТНЫЙ-КЛЮЧ"),
    );
  });
});
