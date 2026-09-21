import { describe, expect, it } from "vitest";
import { SHORTS_MAX_SECONDS, parseIsoDuration } from "@/lib/youtube/duration";
import { chunk } from "@/lib/youtube/videos";
import { shortsUrl, videoUrl } from "@/lib/youtube/video-url";
import { formatCount, formatDateTime } from "@/lib/format";

describe("ссылка на видео", () => {
  it("строится по идентификатору", () => {
    expect(videoUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("страница Shorts — отдельный адрес, он нужен для подтверждения типа", () => {
    expect(shortsUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/shorts/dQw4w9WgXcQ");
  });
});

describe("разбор длительности ISO 8601", () => {
  const cases: ReadonlyArray<readonly [string, number]> = [
    ["PT45S", 45],
    ["PT1M30S", 90],
    ["PT1H2M3S", 3723],
    ["PT10M", 600],
    ["PT1H", 3600],
    ["P1DT2H", 93_600],
    ["P0D", 0],
  ];

  it.each(cases)("%s → %d c", (raw, expected) => {
    expect(parseIsoDuration(raw)).toBe(expected);
  });

  it("неразбираемое значение даёт null, а не ноль", () => {
    expect(parseIsoDuration("что-то не то")).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });

  it("порог Shorts — 180 секунд включительно", () => {
    expect(SHORTS_MAX_SECONDS).toBe(180);
    expect(parseIsoDuration("PT3M")).toBe(SHORTS_MAX_SECONDS);
  });
});

describe("разбиение на пакеты", () => {
  it("режет по 50 и оставляет неполный хвост", () => {
    const ids = Array.from({ length: 137 }, (_, i) => String(i));
    const batches = chunk(ids, 50);

    expect(batches.map((b) => b.length)).toEqual([50, 50, 37]);
    expect(batches.flat()).toEqual(ids);
  });

  it("пустой список даёт ноль пакетов", () => {
    expect(chunk([], 50)).toEqual([]);
  });
});

describe("форматирование для таблицы", () => {
  it("дата в формате из ТЗ", () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 8, 21, 14, 21)))).toBe("2026-09-21 14:21");
  });

  it("однозначные месяц, день, час и минута дополняются нулём", () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 2, 3, 4)))).toBe("2026-01-02 03:04");
  });

  it("счётчик с разделителем разрядов, скрытая статистика — «н/д»", () => {
    expect(formatCount(1_234_567)).toBe("1 234 567");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("н/д");
  });
});
