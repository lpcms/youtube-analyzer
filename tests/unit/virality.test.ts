import { describe, expect, it } from "vitest";
import {
  MAX_SCORE,
  computeVirality,
  engagementRate,
  median,
  type ViralityInput,
} from "@/lib/virality";

function video(
  id: string,
  kind: "VIDEO" | "SHORTS",
  viewCount: number | null,
  likeCount: number | null,
  commentCount: number | null,
): ViralityInput {
  return { id, kind, viewCount, likeCount, commentCount };
}

describe("медиана", () => {
  it("нечётное количество — среднее значение", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("чётное количество — среднее двух средних", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("одно значение — оно само", () => {
    expect(median([7])).toBe(7);
  });

  it("пустая выборка медианы не имеет", () => {
    expect(median([])).toBeNull();
  });

  it("не портит исходный массив", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("вовлечённость", () => {
  it("комментарий весит вдвое против лайка", () => {
    // (10 + 2×5) / 1000 = 0,02
    expect(engagementRate(video("a", "VIDEO", 1000, 10, 5))).toBeCloseTo(0.02, 10);
  });

  it("скрытый счётчик даёт null, а не ноль", () => {
    expect(engagementRate(video("a", "VIDEO", 1000, null, 5))).toBeNull();
    expect(engagementRate(video("b", "VIDEO", 1000, 10, null))).toBeNull();
    expect(engagementRate(video("c", "VIDEO", null, 10, 5))).toBeNull();
  });

  it("нулевые просмотры — делить не на что", () => {
    expect(engagementRate(video("a", "VIDEO", 0, 10, 5))).toBeNull();
  });

  it("настоящие нули в лайках и комментариях дают нулевую вовлечённость", () => {
    expect(engagementRate(video("a", "VIDEO", 1000, 0, 0))).toBe(0);
  });
});

describe("вирусность: посчитано вручную", () => {
  /**
   * Пять видео одного типа. ER = (лайки + 2×комментарии) / просмотры:
   *
   *   v1: (10 + 2×0)/1000  = 0,010   просмотры 1000
   *   v2: (20 + 2×5)/1000  = 0,030   просмотры 1000
   *   v3: (40 + 2×10)/2000 = 0,030   просмотры 2000   ← медиана по обоим
   *   v4: (90 + 2×15)/3000 = 0,040   просмотры 3000
   *   v5: (100 + 2×25)/5000 = 0,030  просмотры 5000
   *
   * ER по возрастанию: 0,010 0,030 0,030 0,030 0,040 → медиана 0,030
   * Просмотры:         1000 1000 2000 3000 5000      → медиана 2000
   */
  const set = [
    video("v1", "VIDEO", 1000, 10, 0),
    video("v2", "VIDEO", 1000, 20, 5),
    video("v3", "VIDEO", 2000, 40, 10),
    video("v4", "VIDEO", 3000, 90, 15),
    video("v5", "VIDEO", 5000, 100, 25),
  ];

  const scores = computeVirality(set);

  it("медианное по обоим показателям видео получает ровно 10,0", () => {
    // 10 × (0,6 × 0,030/0,030 + 0,4 × 2000/2000) = 10 × (0,6 + 0,4) = 10,0
    expect(scores.get("v3")).toBeCloseTo(10.0, 1);
  });

  it("слабое по вовлечённости и охвату — ниже десяти", () => {
    // 10 × (0,6 × 0,010/0,030 + 0,4 × 1000/2000) = 10 × (0,2 + 0,2) = 4,0
    expect(scores.get("v1")).toBe(4);
  });

  it("средняя вовлечённость при малом охвате", () => {
    // 10 × (0,6 × 1 + 0,4 × 0,5) = 10 × 0,8 = 8,0
    expect(scores.get("v2")).toBe(8);
  });

  it("выше медианы по обоим показателям", () => {
    // 10 × (0,6 × 0,040/0,030 + 0,4 × 3000/2000) = 10 × (0,8 + 0,6) = 14,0
    expect(scores.get("v4")).toBe(14);
  });

  it("медианная вовлечённость при большом охвате", () => {
    // 10 × (0,6 × 1 + 0,4 × 5000/2000) = 10 × (0,6 + 1,0) = 16,0
    expect(scores.get("v5")).toBe(16);
  });
});

describe("типы считаются отдельно", () => {
  it("медиана по Shorts не смешивается с медианой по Video", () => {
    // У Video вовлечённость 0,01, у Shorts — 0,10. Если бы медиана была
    // общей, Shorts вылетели бы вверх, а Video провалились вниз.
    const mixed = [
      video("long1", "VIDEO", 1000, 10, 0),
      video("long2", "VIDEO", 1000, 10, 0),
      video("long3", "VIDEO", 1000, 10, 0),
      video("short1", "SHORTS", 1000, 100, 0),
      video("short2", "SHORTS", 1000, 100, 0),
      video("short3", "SHORTS", 1000, 100, 0),
    ];

    const scores = computeVirality(mixed);

    // Каждое видео типичное для своего типа — все получают 10,0.
    for (const id of ["long1", "long2", "long3", "short1", "short2", "short3"]) {
      expect(scores.get(id)).toBeCloseTo(10.0, 1);
    }
  });

  it("один тип без подходящих строк не мешает другому", () => {
    const mixed = [video("long1", "VIDEO", 1000, 10, 1), video("short1", "SHORTS", 0, 5, 1)];

    const scores = computeVirality(mixed);

    expect(scores.get("long1")).toBeCloseTo(10.0, 1);
    expect(scores.get("short1")).toBeNull();
  });
});

describe("край: нечего считать", () => {
  it("скрытая статистика даёт «н/д» и не влияет на медиану", () => {
    const set = [
      video("ok1", "VIDEO", 1000, 10, 0),
      video("hidden", "VIDEO", 1000, null, 0),
      video("ok2", "VIDEO", 1000, 10, 0),
    ];

    const scores = computeVirality(set);

    expect(scores.get("hidden")).toBeNull();
    // Медиана считается по двум оставшимся, и оба они типичные.
    expect(scores.get("ok1")).toBeCloseTo(10.0, 1);
    expect(scores.get("ok2")).toBeCloseTo(10.0, 1);
  });

  it("нулевые просмотры дают «н/д»", () => {
    const scores = computeVirality([
      video("zero", "VIDEO", 0, 0, 0),
      video("ok", "VIDEO", 100, 1, 0),
    ]);

    expect(scores.get("zero")).toBeNull();
  });

  it("единственное видео своего типа получает 10,0, а не падает", () => {
    const scores = computeVirality([video("alone", "VIDEO", 1234, 56, 7)]);

    expect(scores.get("alone")).toBeCloseTo(10.0, 1);
  });

  it("пустая выгрузка не ломает расчёт", () => {
    expect(computeVirality([]).size).toBe(0);
  });

  it("выгрузка сплошь из скрытой статистики даёт «н/д» всем", () => {
    const scores = computeVirality([
      video("a", "VIDEO", null, null, null),
      video("b", "SHORTS", null, null, null),
    ]);

    expect(scores.get("a")).toBeNull();
    expect(scores.get("b")).toBeNull();
  });
});

describe("верхняя граница", () => {
  it("выброс упирается в потолок, а не даёт четырёхзначное число", () => {
    const set = [
      video("normal1", "VIDEO", 100, 1, 0),
      video("normal2", "VIDEO", 100, 1, 0),
      video("viral", "VIDEO", 10_000_000, 5_000_000, 1_000_000),
    ];

    const scores = computeVirality(set);

    expect(scores.get("viral")).toBe(MAX_SCORE);
  });

  it("нулевая медиана вовлечённости не даёт деления на ноль", () => {
    // У большинства нет ни лайков, ни комментариев — медиана ER равна нулю.
    const set = [
      video("dead1", "VIDEO", 100, 0, 0),
      video("dead2", "VIDEO", 100, 0, 0),
      video("alive", "VIDEO", 100, 50, 0),
    ];

    const scores = computeVirality(set);

    // Мёртвые ровно типичны: 10 × (0,6 × 1 + 0,4 × 1) = 10,0
    expect(scores.get("dead1")).toBeCloseTo(10.0, 1);
    // Живое бесконечно лучше нулевой медианы — упирается в потолок.
    expect(scores.get("alive")).toBe(MAX_SCORE);
    expect(Number.isFinite(scores.get("alive"))).toBe(true);
  });
});
