import { describe, expect, it } from "vitest";
import { channelId, videoId } from "../db/fixtures";

describe("идентификаторы в фикстурах", () => {
  it("даёт видео с валидным 11-символьным идентификатором", () => {
    const id = videoId();

    expect(id).toHaveLength(11);
    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it("даёт канал с идентификатором UC и 22 символами после него", () => {
    const id = channelId();

    expect(id).toHaveLength(24);
    expect(id.startsWith("UC")).toBe(true);
  });

  it("не повторяет идентификаторы между вызовами", () => {
    const ids = new Set([videoId(), videoId(), videoId()]);

    expect(ids.size).toBe(3);
  });
});
