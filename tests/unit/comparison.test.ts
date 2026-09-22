import { describe, expect, it } from "vitest";
import {
  compareSnapshots,
  countRows,
  countsLine,
  deltaOf,
  formatDelta,
  formatRatio,
  presenceLabel,
  type SnapshotRow,
} from "@/lib/comparison";

const PUBLISHED = new Date(Date.UTC(2026, 2, 1, 12, 0));

function row(overrides: Partial<SnapshotRow> & { id: string }): SnapshotRow {
  return {
    title: "Видео",
    kind: "VIDEO",
    kindAssumed: false,
    publishedAt: PUBLISHED,
    viewCount: 1000,
    likeCount: 100,
    commentCount: 10,
    ...overrides,
  };
}

describe("прирост метрики", () => {
  it("рост считается числом и долей от прежнего значения", () => {
    expect(deltaOf(1000, 1250)).toEqual({ kind: "value", absolute: 250, ratio: 0.25 });
  });

  it("падение — тот же расчёт с минусом", () => {
    expect(deltaOf(1000, 800)).toEqual({ kind: "value", absolute: -200, ratio: -0.2 });
  });

  it("без изменений — ноль, а не пустая ячейка", () => {
    expect(deltaOf(1000, 1000)).toEqual({ kind: "value", absolute: 0, ratio: 0 });
  });

  it("рост с нуля даёт число, но не долю", () => {
    // Делить на ноль не на что, и «+∞ %» ничего не объясняет.
    expect(deltaOf(0, 42)).toEqual({ kind: "value", absolute: 42, ratio: null });
  });

  it("скрытая в одном снимке метрика не даёт прироста", () => {
    // null — «статистика скрыта автором», а не ноль: неизвестно даже,
    // росла она или падала.
    expect(deltaOf(null, 500)).toEqual({ kind: "hidden" });
    expect(deltaOf(500, null)).toEqual({ kind: "hidden" });
    expect(deltaOf(null, null)).toEqual({ kind: "hidden" });
  });
});

describe("вид прироста", () => {
  it("положительный прирост получает плюс, отрицательный — минус от числа", () => {
    expect(formatDelta(deltaOf(1000, 2234))).toBe("+1 234");
    expect(formatDelta(deltaOf(1000, 944))).toBe("-56");
    expect(formatDelta(deltaOf(1000, 1000))).toBe("0");
  });

  it("скрытая метрика и отсутствующее видео обозначаются по-разному", () => {
    // «н/д» — статистика скрыта, «—» — сравнивать не с чем. Одним знаком
    // на оба случая пришлось бы гадать, что именно произошло.
    expect(formatDelta({ kind: "hidden" })).toBe("н/д");
    expect(formatDelta({ kind: "absent" })).toBe("—");
  });

  it("доля показывается процентами с одной цифрой", () => {
    expect(formatRatio(deltaOf(1000, 1053))).toBe("+5,3 %");
    expect(formatRatio(deltaOf(1000, 800))).toBe("-20,0 %");
    expect(formatRatio(deltaOf(1000, 1000))).toBe("0,0 %");
  });

  it("почти нулевое падение не показывается как «-0,0 %»", () => {
    // Минус при нуле выглядит опечаткой.
    expect(formatRatio(deltaOf(100_000, 99_999))).toBe("0,0 %");
  });

  it("доли нет там, где её не существует", () => {
    expect(formatRatio(deltaOf(0, 42))).toBeNull();
    expect(formatRatio({ kind: "hidden" })).toBeNull();
    expect(formatRatio({ kind: "absent" })).toBeNull();
  });
});

describe("сведение двух снимков", () => {
  it("видео из обоих снимков получает прирост по трём метрикам", () => {
    const rows = compareSnapshots(
      [row({ id: "a", viewCount: 1000, likeCount: 100, commentCount: 10 })],
      [row({ id: "a", viewCount: 1500, likeCount: 90, commentCount: 10 })],
    );

    expect(rows).toHaveLength(1);
    const only = rows[0];
    expect(only?.presence).toBe("both");
    expect(only?.views).toEqual({ kind: "value", absolute: 500, ratio: 0.5 });
    expect(only?.likes).toEqual({ kind: "value", absolute: -10, ratio: -0.1 });
    expect(only?.comments).toEqual({ kind: "value", absolute: 0, ratio: 0 });
  });

  it("видео, которого не было в раннем снимке, помечено новым без прироста", () => {
    // Иначе первые же его цифры выдавались бы за прирост от нуля.
    const rows = compareSnapshots([], [row({ id: "b", viewCount: 700 })]);

    const only = rows[0];
    expect(only?.presence).toBe("new");
    expect(only?.before).toBeNull();
    expect(only?.after?.viewCount).toBe(700);
    expect(only?.views).toEqual({ kind: "absent" });
    expect(presenceLabel("new")).toBe("новое");
  });

  it("видео, исчезнувшее к позднему снимку, остаётся в сравнении с пометкой", () => {
    // Выкинуть его значило бы показать канал, на котором ничего не пропадало.
    const rows = compareSnapshots([row({ id: "c", viewCount: 300 })], []);

    const only = rows[0];
    expect(only?.presence).toBe("gone");
    expect(only?.before?.viewCount).toBe(300);
    expect(only?.after).toBeNull();
    expect(only?.views).toEqual({ kind: "absent" });
    expect(presenceLabel("gone")).toBe("исчезло");
  });

  it("скрытая в одном снимке метрика даёт «н/д», а соседние считаются", () => {
    const rows = compareSnapshots(
      [row({ id: "d", viewCount: 1000, likeCount: null })],
      [row({ id: "d", viewCount: 1200, likeCount: 50 })],
    );

    expect(rows[0]?.likes).toEqual({ kind: "hidden" });
    expect(rows[0]?.views).toEqual({ kind: "value", absolute: 200, ratio: 0.2 });
  });

  it("название берётся из позднего снимка: автор мог переименовать ролик", () => {
    const rows = compareSnapshots(
      [row({ id: "e", title: "Старое название" })],
      [row({ id: "e", title: "Новое название" })],
    );

    expect(rows[0]?.title).toBe("Новое название");
  });

  it("порядок — свежие сверху, как и в обычной таблице", () => {
    const older = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const newer = new Date(Date.UTC(2026, 5, 1, 12, 0));

    const rows = compareSnapshots(
      [row({ id: "old", publishedAt: older })],
      [row({ id: "new", publishedAt: newer })],
    );

    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("считает, сколько сравнено, появилось и исчезло", () => {
    const rows = compareSnapshots(
      [row({ id: "a" }), row({ id: "b" }), row({ id: "gone" })],
      [row({ id: "a" }), row({ id: "b" }), row({ id: "new" })],
    );

    expect(countRows(rows)).toEqual({ compared: 2, added: 1, gone: 1 });
  });

  it("в строке итогов нули не называются", () => {
    // «новых: 0 · исчезло: 0» — шум там, где ничего не произошло.
    expect(countsLine({ compared: 9, added: 0, gone: 0 })).toBe("сравнено: 9");
    expect(countsLine({ compared: 8, added: 1, gone: 2 })).toBe(
      "сравнено: 8 · новых: 1 · исчезло: 2",
    );
  });
});
