/**
 * Превращение ссылки на канал в его идентификатор и плейлист загрузок.
 *
 * Серверный код: обращается к YouTube Data API.
 */

import { callYouTube } from "./api";
import { parseChannelUrl, uploadsPlaylistId, type ChannelRef } from "./channel-url";

export interface ResolvedChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly thumbnailUrl: string | null;
  /** Плейлист `UU…`, через который перебираются видео вместо search.list. */
  readonly uploadsPlaylistId: string;
}

export type ResolveFailure =
  /** Строка не похожа на адрес канала YouTube. */
  | { readonly reason: "invalid-url"; readonly detail: "empty" | "foreign-host" | "unrecognized" }
  /** Адрес разобран, но такого канала нет. */
  | { readonly reason: "not-found" };

export type ResolveResult =
  | { readonly ok: true; readonly channel: ResolvedChannel }
  | { readonly ok: false; readonly failure: ResolveFailure };

interface ChannelsListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

interface SearchListResponse {
  items?: Array<{ id?: { channelId?: string } }>;
}

const CHANNEL_PARTS = "snippet,contentDetails";

/**
 * Параметр `channels.list`, которым разрешается ссылка.
 * Для `custom` прямого параметра у API нет — он обрабатывается отдельно.
 */
function channelsListParam(ref: ChannelRef): Record<string, string> | null {
  switch (ref.kind) {
    case "id":
      return { id: ref.id };
    case "handle":
      // API ждёт хэндл с собачкой.
      return { forHandle: "@" + ref.handle };
    case "username":
      return { forUsername: ref.username };
    case "custom":
      return null;
  }
}

/**
 * Разрешает `/c/Name`. У API нет параметра для таких адресов, остаётся поиск
 * за 100 единиц квоты — в сто раз дороже обычного разрешения.
 */
async function resolveCustomName(name: string): Promise<string | null> {
  const found = await callYouTube<SearchListResponse>("search.list", {
    part: "snippet",
    type: "channel",
    q: name,
    maxResults: "1",
  });

  return found.items?.[0]?.id?.channelId ?? null;
}

function pickThumbnail(
  thumbnails: Record<string, { url?: string } | undefined> | undefined,
): string | null {
  if (thumbnails === undefined) return null;
  // От крупного к мелкому: в списке истории аватар показывается небольшим,
  // но лучше взять качество повыше, чем получить размытое.
  for (const size of ["high", "medium", "default"]) {
    const url = thumbnails[size]?.url;
    if (url !== undefined && url !== "") return url;
  }
  return null;
}

async function fetchChannelById(params: Record<string, string>): Promise<ResolveResult> {
  const response = await callYouTube<ChannelsListResponse>("channels.list", {
    part: CHANNEL_PARTS,
    ...params,
  });

  const item = response.items?.[0];
  const id = item?.id;
  // Несуществующий канал — это пустой items и код 200, а не ошибка.
  if (item === undefined || id === undefined) {
    return { ok: false, failure: { reason: "not-found" } };
  }

  const uploads = item.contentDetails?.relatedPlaylists?.uploads ?? uploadsPlaylistId(id);
  const customUrl = item.snippet?.customUrl;

  return {
    ok: true,
    channel: {
      id,
      title: item.snippet?.title ?? "",
      handle: customUrl !== undefined && customUrl.startsWith("@") ? customUrl : null,
      thumbnailUrl: pickThumbnail(item.snippet?.thumbnails),
      uploadsPlaylistId: uploads,
    },
  };
}

/**
 * Разбирает адрес и разрешает его в канал.
 *
 * Не бросает исключение на «канала нет» — это штатный исход, а не поломка.
 * Ошибки самого API (квота, ключ, сеть) по-прежнему летят наверх
 * как `YouTubeApiError`: они требуют другого разговора с пользователем.
 */
export async function resolveChannel(rawUrl: string): Promise<ResolveResult> {
  const parsed = parseChannelUrl(rawUrl);
  if (!parsed.ok) {
    return { ok: false, failure: { reason: "invalid-url", detail: parsed.error } };
  }

  const ref = parsed.ref;
  const params = channelsListParam(ref);

  if (params !== null) {
    return fetchChannelById(params);
  }

  // Осталась только форма /c/Name.
  const foundId = await resolveCustomName(ref.kind === "custom" ? ref.name : "");
  if (foundId === null) {
    return { ok: false, failure: { reason: "not-found" } };
  }
  return fetchChannelById({ id: foundId });
}
