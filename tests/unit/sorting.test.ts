import { beforeEach, describe, expect, it } from "vitest";
import { videoRows } from "@/lib/fetch-channel";
import {
  DEFAULT_SORT,
  SORT_COLUMNS,
  ariaSort,
  initialDirection,
  nextSort,
  orderByFor,
  parseSort,
  sortArrow,
  type SortColumn,
} from "@/lib/sorting";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun, makeShort, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";

describe("выбор сортировки по клику", () => {
  it("другая колонка начинает со своего направления", () => {
    // Числа интереснее с наибольших, тип и длительность — по порядку.
    expect(initialDirection("viewCount")).toBe("desc");
    expect(initialDirection("viralityScore")).toBe("desc");
    expect(initialDirection("kind")).toBe("asc");
    expect(initialDirection("durationSec")).toBe("asc");
  });

  it("повторный клик по той же колонке переворачивает направление", () => {
    const first = nextSort(DEFAULT_SORT, "viewCount");
    expect(first).toEqual({ column: "viewCount", direction: "desc" });

    const second = nextSort(first, "viewCount");
    expect(second).toEqual({ column: "viewCount", direction: "asc" });

    const third = nextSort(second, "viewCount");
    expect(third).toEqual({ column: "viewCount", direction: "desc" });
  });

  it("переход на другую колонку не наследует направление прежней", () => {
    const byViews = { column: "viewCount", direction: "asc" } as const;

    expect(nextSort(byViews, "kind")).toEqual({ column: "kind", direction: "asc" });
    expect(nextSort(byViews, "likeCount")).toEqual({ column: "likeCount", direction: "desc" });
  });
});

describe("направление в заголовке", () => {
  it("активная колонка объявляется скринридеру", () => {
    expect(ariaSort({ column: "viewCount", direction: "asc" }, "viewCount")).toBe("ascending");
    expect(ariaSort({ column: "viewCount", direction: "desc" }, "viewCount")).toBe("descending");
  });

  it("неактивная колонка — none", () => {
    expect(ariaSort({ column: "viewCount", direction: "asc" }, "likeCount")).toBe("none");
  });

  it("стрелка рисуется только у активной колонки", () => {
    expect(sortArrow({ column: "viewCount", direction: "asc" }, "viewCount")).toBe("↑");
    expect(sortArrow({ column: "viewCount", direction: "desc" }, "viewCount")).toBe("↓");
    expect(sortArrow({ column: "viewCount", direction: "desc" }, "kind")).toBe("");
  });
});

describe("разбор сортировки из запроса", () => {
  it("понятные значения принимаются", () => {
    expect(parseSort("likeCount", "asc")).toEqual({ column: "likeCount", direction: "asc" });
  });

  it("незнакомая колонка молча заменяется умолчанием", () => {
    // Это оформление таблицы, а не данные: ронять запрос из-за него незачем.
    expect(parseSort("DROP TABLE", "asc")).toEqual(DEFAULT_SORT);
    expect(parseSort(null, null)).toEqual(DEFAULT_SORT);
  });

  it("незнакомое направление не отменяет саму колонку", () => {
    expect(parseSort("likeCount", "вверх")).toEqual({
      column: "likeCount",
      direction: DEFAULT_SORT.direction,
    });
  });
});

describe("запрос к базе", () => {
  it("колонки снимка сортируются напрямую, колонки видео — через связь", () => {
    expect(orderByFor({ column: "viewCount", direction: "desc" })[0]).toEqual({
      viewCount: { sort: "desc", nulls: "last" },
    });
    expect(orderByFor({ column: "publishedAt", direction: "desc" })[0]).toEqual({
      video: { publishedAt: "desc" },
    });
  });

  it("«н/д» уходит в конец при любом направлении", () => {
    for (const direction of ["asc", "desc"] as const) {
      expect(orderByFor({ column: "likeCount", direction })[0]).toEqual({
        likeCount: { sort: direction, nulls: "last" },
      });
    }
  });

  it("вторым ключом идёт идентификатор — иначе порядок равных строк плавает", () => {
    // Без устойчивого ключа пагинация показала бы одну строку дважды,
    // а другую ни разу.
    for (const column of SORT_COLUMNS) {
      const order = orderByFor({ column, direction: "desc" });
      expect(order).toHaveLength(2);
      expect(order[1]).toEqual({ videoId: "asc" });
    }
  });
});

describe("порядок строк из базы", () => {
  /** Четыре видео: у одного просмотры скрыты. */
  async function seed(): Promise<string> {
    const channel = await makeChannel();
    const run = await makeFetchRun({ channelId: channel.id });

    const rows: ReadonlyArray<[number, number | null, number]> = [
      [600, 500, 5],
      [120, 9000, 1],
      [3600, 70, 9],
      [45, null, 3],
    ];

    for (const [durationSec, viewCount, virality] of rows) {
      const video =
        durationSec <= 180
          ? await makeShort({ channelId: channel.id, durationSec })
          : await makeVideo({ channelId: channel.id, durationSec });

      await makeVideoStat({
        videoId: video.id,
        fetchRunId: run.id,
        viewCount,
        viralityScore: virality,
      });
    }

    return run.id;
  }

  beforeEach(async () => {
    await resetDb();
  });

  it("по просмотрам от больших к меньшим", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "desc" },
    });

    expect(rows.map((r) => r.viewCount)).toEqual([9000, 500, 70, null]);
  });

  it("по просмотрам от меньших к большим, «н/д» всё равно в конце", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "asc" },
    });

    // Скрытая статистика ничего не сообщает — наверху ей делать нечего.
    expect(rows.map((r) => r.viewCount)).toEqual([70, 500, 9000, null]);
  });

  it("по длительности", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "durationSec", direction: "asc" },
    });

    expect(rows.map((r) => r.durationSec)).toEqual([45, 120, 600, 3600]);
  });

  it("по вирусности от больших к меньшим", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "viralityScore", direction: "desc" },
    });

    expect(rows.map((r) => r.viralityScore)).toEqual([9, 5, 3, 1]);
  });

  it("по типу: Shorts и Video группируются", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "kind", direction: "asc" },
    });

    const kinds = rows.map((r) => r.kind);
    expect(kinds.slice(0, 2)).toEqual(["SHORTS", "SHORTS"]);
    expect(kinds.slice(2)).toEqual(["VIDEO", "VIDEO"]);
  });

  it("сортировка охватывает всю выгрузку, а не часть", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "desc" },
    });

    expect(rows).toHaveLength(4);
  });

  it("по умолчанию — свежие сверху", async () => {
    const runId = await seed();

    const rows = await videoRows(runId, { prisma: testPrisma });
    const dates = rows.map((r) => r.publishedAt.getTime());

    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("каждая сортируемая колонка отрабатывает без ошибки", async () => {
    const runId = await seed();

    for (const column of SORT_COLUMNS as readonly SortColumn[]) {
      for (const direction of ["asc", "desc"] as const) {
        const rows = await videoRows(runId, { prisma: testPrisma, sort: { column, direction } });
        expect(rows).toHaveLength(4);
      }
    }
  });
});
