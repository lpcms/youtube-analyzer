/**
 * Заглушка YouTube Data API для E2E.
 *
 * Поднимается рядом с дев-сервером Next, который на время прогона смотрит
 * на неё через YOUTUBE_API_BASE. Нужна потому, что запрос к API уходит
 * с сервера, а не из браузера — page.route его не видит.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_YOUTUBE_PORT ?? 3101);
const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const COUNT = 10;

const videoIds = Array.from({ length: COUNT }, (_, i) =>
  `e2evid${String(i).padStart(5, "0")}`.slice(0, 11),
);

function channels() {
  return {
    items: [
      {
        id: CHANNEL_ID,
        snippet: { title: "Канал для E2E", customUrl: "@e2e", thumbnails: {} },
        contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
      },
    ],
  };
}

function playlistItems() {
  return { items: videoIds.map((id) => ({ contentDetails: { videoId: id } })) };
}

function videos(requested) {
  return {
    items: requested.map((id) => {
      const i = videoIds.indexOf(id);
      return {
        id,
        snippet: {
          title: `Видео ${i}`,
          description: "",
          publishedAt: new Date(Date.UTC(2026, 8, 21 - i, 12, 0)).toISOString(),
        },
        contentDetails: { duration: i % 2 === 0 ? "PT10M" : "PT45S" },
        statistics: { viewCount: String(1000 * (i + 1)), likeCount: "10", commentCount: "1" },
      };
    }),
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body;

  if (url.pathname.endsWith("/channels")) body = channels();
  else if (url.pathname.endsWith("/playlistItems")) body = playlistItems();
  else if (url.pathname.endsWith("/videos"))
    body = videos((url.searchParams.get("id") ?? "").split(","));
  else {
    res.writeHead(404).end("{}");
    return;
  }

  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`[mock-youtube] слушает http://127.0.0.1:${PORT}`);
});
