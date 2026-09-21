/**
 * Разбор адреса канала YouTube.
 *
 * Чистая функция без сети: превращает то, что пользователь вставил в форму,
 * в ссылку на канал одного из четырёх видов. Превращение ссылки в настоящий
 * идентификатор — уже обращение к API, оно в resolve-channel.ts.
 */

/** Ссылка на канал в том виде, в каком её удалось вычитать из адреса. */
export type ChannelRef =
  /** `/channel/UC…` — идентификатор уже известен, обращаться к API не за чем. */
  | { readonly kind: "id"; readonly id: string }
  /** `/@handle` — разрешается через `channels.list?forHandle`, 1 единица квоты. */
  | { readonly kind: "handle"; readonly handle: string }
  /** `/user/Name` — устаревшая форма, `channels.list?forUsername`, 1 единица. */
  | { readonly kind: "username"; readonly username: string }
  /** `/c/Name` — у API нет прямого способа, только `search.list` за 100 единиц. */
  | { readonly kind: "custom"; readonly name: string };

export type ChannelUrlError =
  /** Пустая строка. */
  | "empty"
  /** Домен не youtube.com. */
  | "foreign-host"
  /** Домен наш, но путь ни на что не похож. */
  | "unrecognized";

export type ChannelUrlResult =
  | { readonly ok: true; readonly ref: ChannelRef }
  | { readonly ok: false; readonly error: ChannelUrlError };

/**
 * Хвосты, которые YouTube дописывает к адресу канала. Отбрасываются:
 * пользователь копирует адрес с открытой вкладки, и там почти всегда хвост.
 */
const CHANNEL_TABS = new Set([
  "videos",
  "shorts",
  "streams",
  "live",
  "featured",
  "playlists",
  "community",
  "about",
  "posts",
  "podcasts",
  "releases",
  "store",
]);

/** Домены, которые считаем YouTube. `youtu.be` — про видео, не про канал. */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/** Идентификатор канала: `UC` плюс 22 символа алфавита base64url. */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** Хэндл без `@`: 3–30 символов, буквы, цифры, точка, дефис, подчёркивание. */
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;

function normalizeInput(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Пользователь вставляет и `youtube.com/@x`, и `https://www.youtube.com/@x`.
  // Без схемы URL не разбирается, поэтому дописываем её — но только когда
  // схемы нет вовсе: `http://` оставляем как есть, чтобы не спрятать чужой домен.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;

  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Отбрасывает хвост вкладки: `/@handle/videos` → `["@handle"]`. */
function pathSegments(url: URL): string[] {
  const segments = url.pathname.split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1];

  if (segments.length > 1 && last !== undefined && CHANNEL_TABS.has(last.toLowerCase())) {
    return segments.slice(0, -1);
  }
  return segments;
}

export function parseChannelUrl(raw: string): ChannelUrlResult {
  if (raw.trim() === "") {
    return { ok: false, error: "empty" };
  }

  const url = normalizeInput(raw);
  if (url === null) {
    return { ok: false, error: "foreign-host" };
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: "foreign-host" };
  }

  const segments = pathSegments(url);
  const first = segments[0];
  if (first === undefined) {
    return { ok: false, error: "unrecognized" };
  }

  // /@handle
  if (first.startsWith("@")) {
    const handle = first.slice(1);
    return HANDLE.test(handle)
      ? { ok: true, ref: { kind: "handle", handle } }
      : { ok: false, error: "unrecognized" };
  }

  const second = segments[1];
  if (second === undefined) {
    return { ok: false, error: "unrecognized" };
  }

  switch (first.toLowerCase()) {
    case "channel":
      return CHANNEL_ID.test(second)
        ? { ok: true, ref: { kind: "id", id: second } }
        : { ok: false, error: "unrecognized" };

    case "user":
      return { ok: true, ref: { kind: "username", username: second } };

    case "c":
      return { ok: true, ref: { kind: "custom", name: second } };

    default:
      return { ok: false, error: "unrecognized" };
  }
}

/**
 * Плейлист загрузок канала получается из его идентификатора заменой `UC` на `UU`.
 * Отдельного вызова API для этого не нужно.
 */
export function uploadsPlaylistId(channelId: string): string {
  return "UU" + channelId.slice(2);
}
