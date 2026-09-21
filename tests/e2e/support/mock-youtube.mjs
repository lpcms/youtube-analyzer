/**
 * Заглушка YouTube для E2E.
 *
 * Поднимается рядом с дев-сервером Next, который на время прогона смотрит
 * на неё через YOUTUBE_API_BASE и YOUTUBE_WEB_BASE. Нужна потому, что
 * запросы уходят с сервера, а не из браузера — page.route их не видит.
 *
 * Отдаёт 137 видео тремя страницами (50 + 50 + 37): канал заведомо больше
 * одной страницы, иначе постраничный обход не проверялся бы вовсе.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_YOUTUBE_PORT ?? 3101);
const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const PAGE_SIZE = 50;

export const TOTAL = 137;

const videoIds = Array.from({ length: TOTAL }, (_, i) =>
  `v${String(i).padStart(10, "0")}`.slice(0, 11),
);

/** Нечётные — короткие и настоящие Shorts, чётные — длинные видео. */
const isShort = (i) => i % 2 === 1;

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

/**
 * Задержка на страницу. Без неё выгрузка успевает кончиться раньше, чем тест
 * посмотрит на прогресс, и проверять было бы нечего.
 */
const PAGE_DELAY_MS = Number(process.env.MOCK_PAGE_DELAY_MS ?? 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playlistItems(params) {
  const maxResults = Number(params.get("maxResults") ?? PAGE_SIZE);
  const offset = Number(params.get("pageToken") ?? "0");
  const slice = videoIds.slice(offset, offset + maxResults);
  const next = offset + slice.length;

  return {
    items: slice.map((id) => ({ contentDetails: { videoId: id } })),
    // Оценка объёма — из неё интерфейс строит «из ~137».
    pageInfo: { totalResults: TOTAL },
    ...(next < videoIds.length ? { nextPageToken: String(next) } : {}),
  };
}

/**
 * Описания разной длины: пустое, короткое и длинное с разметкой внутри.
 * Разметка обязана остаться видимым текстом, а не превратиться в элементы.
 */
function describe(i) {
  if (i % 4 === 0) return "";
  if (i % 4 === 1) return "Короткое описание";
  if (i % 4 === 2) return '<b>жирный</b> и <img src=x onerror="alert(1)">';
  return "Начало длинного описания. " + "текст ".repeat(40);
}

function videos(requested) {
  return {
    items: requested.map((id) => {
      const i = videoIds.indexOf(id);
      return {
        id,
        snippet: {
          title: `Видео ${i}`,
          description: describe(i),
          publishedAt: new Date(Date.UTC(2026, 0, 1 + i, 12, 0)).toISOString(),
        },
        contentDetails: { duration: isShort(i) ? "PT45S" : "PT10M" },
        statistics: {
          viewCount: String(1000 * (i + 1)),
          // У каждого третьего лайки скрыты — поля просто нет, и это null,
          // а не ноль. В таблице должно получиться «н/д».
          // У остальных значения разные, иначе направление сортировки
          // по этой колонке было бы неразличимо.
          ...(i % 3 === 0 ? {} : { likeCount: String(10 * (i + 1)) }),
          commentCount: i === 0 ? "0" : "1",
        },
      };
    }),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // Страница Shorts: настоящий Short отвечает 200, обычное видео —
  // редиректом на /watch.
  if (url.pathname.startsWith("/shorts/")) {
    const id = url.pathname.slice("/shorts/".length);
    const i = videoIds.indexOf(id);
    if (i >= 0 && isShort(i)) {
      res.writeHead(200, { "content-type": "text/html" }).end("<html>short</html>");
    } else {
      res.writeHead(303, { location: `https://www.youtube.com/watch?v=${id}` }).end();
    }
    return;
  }

  let body;

  if (url.pathname.endsWith("/channels")) body = channels();
  else if (url.pathname.endsWith("/playlistItems")) {
    if (PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
    body = playlistItems(url.searchParams);
  } else if (url.pathname.endsWith("/videos"))
    body = videos((url.searchParams.get("id") ?? "").split(","));
  else {
    res.writeHead(404).end("{}");
    return;
  }

  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`[mock-youtube] слушает http://127.0.0.1:${PORT}, видео: ${TOTAL}`);
});
