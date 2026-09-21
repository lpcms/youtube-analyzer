import { describe, expect, it } from "vitest";
import { parseChannelUrl, uploadsPlaylistId } from "@/lib/youtube/channel-url";
import type { ChannelRef, ChannelUrlError } from "@/lib/youtube/channel-url";

const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";

describe("разбор адреса канала: поддерживаемые формы", () => {
  const cases: ReadonlyArray<readonly [string, ChannelRef]> = [
    ["https://www.youtube.com/@MrBeast", { kind: "handle", handle: "MrBeast" }],
    ["https://youtube.com/@MrBeast", { kind: "handle", handle: "MrBeast" }],
    ["youtube.com/@MrBeast", { kind: "handle", handle: "MrBeast" }],
    ["www.youtube.com/@MrBeast", { kind: "handle", handle: "MrBeast" }],
    ["https://m.youtube.com/@MrBeast", { kind: "handle", handle: "MrBeast" }],
    ["  https://www.youtube.com/@MrBeast  ", { kind: "handle", handle: "MrBeast" }],
    [`https://www.youtube.com/channel/${CHANNEL_ID}`, { kind: "id", id: CHANNEL_ID }],
    [`youtube.com/channel/${CHANNEL_ID}`, { kind: "id", id: CHANNEL_ID }],
    ["https://www.youtube.com/c/PewDiePie", { kind: "custom", name: "PewDiePie" }],
    ["https://www.youtube.com/user/PewDiePie", { kind: "username", username: "PewDiePie" }],
    ["https://www.youtube.com/@dot.name_x-1", { kind: "handle", handle: "dot.name_x-1" }],
  ];

  it.each(cases)("%s", (input, expected) => {
    const result = parseChannelUrl(input);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref).toEqual(expected);
  });
});

describe("разбор адреса канала: хвосты и строка запроса", () => {
  const cases: ReadonlyArray<readonly [string, ChannelRef]> = [
    ["https://www.youtube.com/@MrBeast/videos", { kind: "handle", handle: "MrBeast" }],
    ["https://www.youtube.com/@MrBeast/shorts", { kind: "handle", handle: "MrBeast" }],
    ["https://www.youtube.com/@MrBeast/streams", { kind: "handle", handle: "MrBeast" }],
    ["https://www.youtube.com/@MrBeast/featured", { kind: "handle", handle: "MrBeast" }],
    ["https://www.youtube.com/@MrBeast/", { kind: "handle", handle: "MrBeast" }],
    ["https://www.youtube.com/@MrBeast?si=abc", { kind: "handle", handle: "MrBeast" }],
    ["https://www.youtube.com/@MrBeast/videos?view=0#top", { kind: "handle", handle: "MrBeast" }],
    [`https://www.youtube.com/channel/${CHANNEL_ID}/shorts`, { kind: "id", id: CHANNEL_ID }],
    ["https://www.youtube.com/c/PewDiePie/videos", { kind: "custom", name: "PewDiePie" }],
  ];

  it.each(cases)("%s", (input, expected) => {
    const result = parseChannelUrl(input);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref).toEqual(expected);
  });
});

describe("разбор адреса канала: отклоняемый ввод", () => {
  const cases: ReadonlyArray<readonly [string, ChannelUrlError]> = [
    ["", "empty"],
    ["   ", "empty"],
    ["https://vimeo.com/@MrBeast", "foreign-host"],
    ["https://youtube.com.evil.example/@MrBeast", "foreign-host"],
    ["https://youtu.be/dQw4w9WgXcQ", "foreign-host"],
    ["просто текст", "foreign-host"],
    ["https://www.youtube.com/", "unrecognized"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "unrecognized"],
    ["https://www.youtube.com/channel/не-идентификатор", "unrecognized"],
    ["https://www.youtube.com/@ab", "unrecognized"],
  ];

  it.each(cases)("%s → %s", (input, expected) => {
    const result = parseChannelUrl(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(expected);
  });
});

describe("плейлист загрузок", () => {
  it("получается из идентификатора канала заменой UC на UU", () => {
    expect(uploadsPlaylistId(CHANNEL_ID)).toBe("UUX6OQ3DkcsbYNE6H8uQQuVA");
  });
});
