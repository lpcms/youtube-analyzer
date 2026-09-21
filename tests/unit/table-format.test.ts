import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_PREVIEW,
  descriptionPreview,
  formatCount,
  formatDateTime,
  formatDuration,
  formatVirality,
  isDescriptionTruncated,
} from "@/lib/format";

describe("длительность", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, "0:00"],
    [7, "0:07"],
    [45, "0:45"],
    [90, "1:30"],
    [600, "10:00"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
    [36_000, "10:00:00"],
  ];

  it.each(cases)("%d c → %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("часы не показываются, когда их нет", () => {
    // `0:01:30` читается хуже, чем `1:30`.
    expect(formatDuration(90)).not.toContain("0:01");
  });

  it("минуты дополняются нулём только при наличии часов", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(3690)).toBe("1:01:30");
  });

  it("отрицательное и дробное не ломают вывод", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(90.7)).toBe("1:30");
  });
});

describe("дата", () => {
  it("в формате из ТЗ", () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 8, 21, 14, 21)))).toBe("2026-09-21 14:21");
  });

  it("однозначные значения дополняются нулём", () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 2, 3, 4)))).toBe("2026-01-02 03:04");
  });

  it("полночь выводится как 00:00, а не пропадает", () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 11, 31, 0, 0)))).toBe("2026-12-31 00:00");
  });
});

describe("счётчики", () => {
  it("разделитель разрядов — обычный пробел", () => {
    expect(formatCount(1_234_567)).toBe("1 234 567");
    expect(formatCount(1000)).toBe("1 000");
  });

  it("ноль остаётся нулём, а не превращается в «н/д»", () => {
    // Ноль лайков и скрытые лайки — разные факты.
    expect(formatCount(0)).toBe("0");
  });

  it("отсутствующий счётчик — «н/д»", () => {
    expect(formatCount(null)).toBe("н/д");
  });

  it("сотни без разделителя", () => {
    expect(formatCount(999)).toBe("999");
  });
});

describe("вирусность", () => {
  it("одна цифра после запятой", () => {
    expect(formatVirality(10)).toBe("10,0");
    expect(formatVirality(7.25)).toBe("7,3");
    expect(formatVirality(0)).toBe("0,0");
  });

  it("непосчитанная — «н/д»", () => {
    expect(formatVirality(null)).toBe("н/д");
  });
});

describe("описание", () => {
  it("короткое не сокращается", () => {
    expect(isDescriptionTruncated("Короткое описание")).toBe(false);
    expect(descriptionPreview("Короткое описание")).toBe("Короткое описание");
  });

  it("длинное сокращается с многоточием", () => {
    const long = "а".repeat(DESCRIPTION_PREVIEW + 50);

    expect(isDescriptionTruncated(long)).toBe(true);
    expect(descriptionPreview(long)).toHaveLength(DESCRIPTION_PREVIEW + 1);
    expect(descriptionPreview(long).endsWith("…")).toBe(true);
  });

  it("берётся первая строка многострочного описания", () => {
    const text = "Первая строка\n\nСсылки:\nhttps://example.test";

    expect(descriptionPreview(text)).toBe("Первая строка");
    expect(isDescriptionTruncated(text)).toBe(true);
  });

  it("пустое описание не считается сокращённым", () => {
    expect(isDescriptionTruncated("")).toBe(false);
    expect(isDescriptionTruncated("   ")).toBe(false);
  });

  it("описание, начинающееся с пустой строки, не даёт пустой предпросмотр", () => {
    expect(descriptionPreview("\n\nТекст после переносов")).toBe("Текст после переносов");
  });
});
