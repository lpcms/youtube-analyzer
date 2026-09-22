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

/**
 * Меняющийся канал: один и тот же канал YouTube в двух состояниях.
 *
 * Состояние выбирается хэндлом в адресе, а не счётчиком обращений: счётчик
 * пережил бы прогон (заглушка переиспользуется между запусками) и на второй
 * раз отдавал бы уже не то. С хэндлом тест говорит прямо, какое состояние
 * канала ему нужно, и не зависит ни от порядка тестов, ни от прошлого прогона.
 *
 * Между состояниями два ролика пропали, один появился: 10 → 9.
 */
const CHANGING_ID = "UCchangingE2EchannelXYZ";
const CHANGING_UPLOADS = "UUchangingE2EchannelXYZ";

const changingIds = Array.from({ length: 11 }, (_, i) =>
  `c${String(i).padStart(10, "0")}`.slice(0, 11),
);

/** Было: десять роликов. Стало: c8 и c9 пропали, появился c10. */
const CHANGING = {
  "@e2e-gen1": changingIds.slice(0, 10),
  "@e2e-gen2": [...changingIds.slice(0, 8), changingIds[10]],
};

export const CHANGING_BEFORE = CHANGING["@e2e-gen1"].length;
export const CHANGING_AFTER = CHANGING["@e2e-gen2"].length;
/** Сколько роликов пропало между состояниями. */
export const CHANGING_VANISHED = CHANGING["@e2e-gen1"].filter(
  (id) => !CHANGING["@e2e-gen2"].includes(id),
).length;

/** Какое состояние меняющегося канала сейчас отдавать. */
let changingState = "@e2e-gen1";

/**
 * Канал, на котором кончается квота.
 *
 * Первая страница отдаётся, вторая отвечает 403 quotaExceeded — так выглядит
 * настоящее исчерпание квоты посреди выгрузки. Собранные полсотни строк
 * обязаны уцелеть.
 */
const QUOTA_ID = "UCquotaE2EchannelXYZabc";
const QUOTA_UPLOADS = "UUquotaE2EchannelXYZabc";

export const QUOTA_FIRST_PAGE = PAGE_SIZE;

const quotaIds = Array.from({ length: 60 }, (_, i) =>
  `q${String(i).padStart(10, "0")}`.slice(0, 11),
);

/** Канал, при обращении к которому API не принимает ключ. */
const BAD_KEY_HANDLE = "@e2e-badkey";

function quotaError() {
  return {
    error: {
      message: "The request cannot be completed because you have exceeded your quota.",
      errors: [{ reason: "quotaExceeded" }],
    },
  };
}

function channels(params) {
  const handle = params.get("forHandle") ?? "";

  if (handle === "@e2e-quota") {
    return {
      items: [
        {
          id: QUOTA_ID,
          snippet: { title: "Канал с кончившейся квотой", customUrl: handle, thumbnails: {} },
          contentDetails: { relatedPlaylists: { uploads: QUOTA_UPLOADS } },
        },
      ],
    };
  }

  if (handle in CHANGING) {
    // Плейлист загрузок один на оба состояния: канал-то один и тот же,
    // и в базе он обязан остаться одной записью.
    changingState = handle;
    return {
      items: [
        {
          id: CHANGING_ID,
          snippet: { title: "Меняющийся канал", customUrl: handle, thumbnails: {} },
          contentDetails: { relatedPlaylists: { uploads: CHANGING_UPLOADS } },
        },
      ],
    };
  }

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
  const playlist = params.get("playlistId") ?? UPLOADS;
  const all =
    playlist === CHANGING_UPLOADS
      ? CHANGING[changingState]
      : playlist === QUOTA_UPLOADS
        ? quotaIds
        : videoIds;

  const maxResults = Number(params.get("maxResults") ?? PAGE_SIZE);
  const offset = Number(params.get("pageToken") ?? "0");

  // Квота кончается ровно на второй странице: первая уже собрана и сохранена.
  if (playlist === QUOTA_UPLOADS && offset > 0) return { quotaExceeded: true };
  const slice = all.slice(offset, offset + maxResults);
  const next = offset + slice.length;

  return {
    items: slice.map((id) => ({ contentDetails: { videoId: id } })),
    // Оценка объёма — из неё интерфейс строит «из ~137».
    pageInfo: { totalResults: all.length },
    ...(next < all.length ? { nextPageToken: String(next) } : {}),
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

/** Ролик меняющегося канала: обычное видео, просмотры разные. */
function changingVideo(id) {
  const i = changingIds.indexOf(id);
  return {
    id,
    snippet: {
      title: `Меняющееся видео ${i}`,
      description: "",
      publishedAt: new Date(Date.UTC(2026, 2, 1 + i, 12, 0)).toISOString(),
    },
    contentDetails: { duration: "PT10M" },
    statistics: {
      viewCount: String(500 * (i + 1)),
      likeCount: String(5 * (i + 1)),
      commentCount: "2",
    },
  };
}

/** Ролик квотного канала: обычное видео, лишь бы отличалось по просмотрам. */
function quotaVideo(id) {
  const i = quotaIds.indexOf(id);
  return {
    id,
    snippet: {
      title: `Видео до квоты ${i}`,
      description: "",
      publishedAt: new Date(Date.UTC(2026, 4, 1 + i, 12, 0)).toISOString(),
    },
    contentDetails: { duration: "PT10M" },
    statistics: {
      viewCount: String(700 * (i + 1)),
      likeCount: String(7 * (i + 1)),
      commentCount: "3",
    },
  };
}

function videos(requested) {
  return {
    items: requested.map((id) => {
      if (changingIds.includes(id)) return changingVideo(id);
      if (quotaIds.includes(id)) return quotaVideo(id);

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

  if (url.pathname.endsWith("/channels")) {
    // Ключ не принят — отказ приходит уже на разрешении канала.
    if (url.searchParams.get("forHandle") === BAD_KEY_HANDLE) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: { message: "API key not valid", errors: [{ reason: "keyInvalid" }] },
        }),
      );
      return;
    }
    body = channels(url.searchParams);
  } else if (url.pathname.endsWith("/playlistItems")) {
    if (PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
    body = playlistItems(url.searchParams);

    if (body.quotaExceeded === true) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(quotaError()));
      return;
    }
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
