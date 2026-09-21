import { beforeEach, describe, expect, it } from "vitest";
import { videoPage, videoRows } from "@/lib/fetch-channel";
import {
  DEFAULT_PAGE_SIZE,
  MIN_PAGE_SIZE,
  PAGE_SIZES,
  clampPage,
  isPageSize,
  offsetFor,
  pageAfterResize,
  pageCount,
  parsePage,
  rowRange,
} from "@/lib/pagination";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";

describe("число страниц", () => {
  const cases: ReadonlyArray<readonly [number, number, number]> = [
    [100, 25, 4],
    [137, 50, 3],
    [50, 50, 1],
    [51, 50, 2],
    [1, 50, 1],
  ];

  it.each(cases)("%d строк по %d на странице → %d", (total, size, expected) => {
    expect(pageCount(total, size)).toBe(expected);
  });

  it("неполная последняя страница всё равно считается", () => {
    expect(pageCount(137, 50)).toBe(3);
    expect(rowRange({ page: 3, pageSize: 50 }, 137)).toEqual({ from: 101, to: 137 });
  });

  it("пустая выгрузка — одна страница, а не ноль", () => {
    // «Страница 1 из 0» звучит бессмысленно, а показывать нечего в любом случае.
    expect(pageCount(0, 50)).toBe(1);
  });
});

describe("границы страницы", () => {
  it("номер загоняется в существующие пределы", () => {
    expect(clampPage(0, 137, 50)).toBe(1);
    expect(clampPage(-5, 137, 50)).toBe(1);
    expect(clampPage(99, 137, 50)).toBe(3);
    expect(clampPage(2, 137, 50)).toBe(2);
  });

  it("дробный и нечисловой номер не ломают расчёт", () => {
    expect(clampPage(2.7, 137, 50)).toBe(2);
    expect(clampPage(Number.NaN, 137, 50)).toBe(1);
  });

  it("смещение считается с единицы", () => {
    expect(offsetFor({ page: 1, pageSize: 50 })).toBe(0);
    expect(offsetFor({ page: 2, pageSize: 20 })).toBe(20);
    expect(offsetFor({ page: 3, pageSize: 25 })).toBe(50);
  });
});

describe("диапазон строк для подписи", () => {
  it("вторая страница по двадцать — строки 21–40", () => {
    expect(rowRange({ page: 2, pageSize: 20 }, 137)).toEqual({ from: 21, to: 40 });
  });

  it("последняя страница обрезается по общему числу", () => {
    expect(rowRange({ page: 3, pageSize: 50 }, 137)).toEqual({ from: 101, to: 137 });
  });

  it("пустая выгрузка не даёт «строки 1–0»", () => {
    expect(rowRange({ page: 1, pageSize: 50 }, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("разбор страницы из запроса", () => {
  it("понятные значения принимаются", () => {
    expect(parsePage(3, 25)).toEqual({ page: 3, pageSize: 25 });
  });

  it("чужой размер страницы заменяется умолчанием", () => {
    // Это оформление таблицы, а не данные: ронять запрос из-за него незачем.
    expect(parsePage(2, 1000)).toEqual({ page: 2, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePage(2, "много")).toEqual({ page: 2, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("мусор в номере страницы даёт первую", () => {
    for (const bad of [0, -1, 2.5, "abc", null, undefined]) {
      expect(parsePage(bad, 50).page).toBe(1);
    }
  });

  it("допустимые размеры опознаются", () => {
    for (const size of PAGE_SIZES) expect(isPageSize(size)).toBe(true);
    expect(isPageSize(30)).toBe(false);
  });
});

describe("смена размера страницы", () => {
  it("держит первую видимую строку, а не отбрасывает в начало", () => {
    // Со сотни на двадцать пять: были видны строки 101–200, значит
    // нужная строка 101 — это пятая страница по двадцать пять.
    expect(pageAfterResize({ page: 2, pageSize: 100 }, 25, 500)).toBe(5);
  });

  it("укрупнение размера сводит страницы", () => {
    expect(pageAfterResize({ page: 5, pageSize: 25 }, 100, 500)).toBe(2);
  });

  it("не уводит за последнюю страницу", () => {
    expect(pageAfterResize({ page: 5, pageSize: 25 }, 100, 137)).toBe(2);
  });
});

describe("страница из базы", () => {
  const TOTAL = 137;

  /** Выгрузка из 137 строк с разными просмотрами. */
  async function seed(): Promise<string> {
    const channel = await makeChannel();
    const run = await makeFetchRun({ channelId: channel.id });

    for (let i = 0; i < TOTAL; i += 1) {
      const video = await makeVideo({
        channelId: channel.id,
        publishedAt: new Date(Date.UTC(2026, 0, 1 + i, 12, 0)),
      });
      await makeVideoStat({
        videoId: video.id,
        fetchRunId: run.id,
        viewCount: (i + 1) * 100,
      });
    }

    return run.id;
  }

  beforeEach(async () => {
    await resetDb();
  });

  it("первая страница отдаёт заданное число строк и общее количество", async () => {
    const runId = await seed();

    const page = await videoPage(runId, {
      prisma: testPrisma,
      page: { page: 1, pageSize: 50 },
    });

    expect(page.rows).toHaveLength(50);
    expect(page.total).toBe(TOTAL);
    expect(page.pageCount).toBe(3);
    expect(page.page).toBe(1);
  });

  it("вторая страница по двадцать возвращает строки 21–40 в порядке сортировки", async () => {
    const runId = await seed();

    const all = await videoRows(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "desc" },
    });
    const page = await videoPage(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "desc" },
      page: { page: 2, pageSize: 20 },
    });

    expect(page.rows.map((r) => r.id)).toEqual(all.slice(20, 40).map((r) => r.id));
  });

  it("последняя страница неполная", async () => {
    const runId = await seed();

    const page = await videoPage(runId, {
      prisma: testPrisma,
      page: { page: 3, pageSize: 50 },
    });

    expect(page.rows).toHaveLength(TOTAL - 100);
  });

  it("страница за краем возвращает последнюю, а не пустоту", async () => {
    const runId = await seed();

    const page = await videoPage(runId, {
      prisma: testPrisma,
      page: { page: 99, pageSize: 50 },
    });

    // «Страница 99 из 3» с пустой таблицей выглядела бы поломкой.
    expect(page.page).toBe(3);
    expect(page.rows).toHaveLength(TOTAL - 100);
  });

  it("страницы не перекрываются и покрывают выгрузку целиком", async () => {
    const runId = await seed();

    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const chunk = await videoPage(runId, {
        prisma: testPrisma,
        sort: { column: "viewCount", direction: "desc" },
        page: { page, pageSize: 50 },
      });
      seen.push(...chunk.rows.map((r) => r.id));
    }

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it("сортировка действует на всю выгрузку, а не внутри страницы", async () => {
    const runId = await seed();

    const first = await videoPage(runId, {
      prisma: testPrisma,
      sort: { column: "viewCount", direction: "desc" },
      page: { page: 1, pageSize: 10 },
    });

    // Самое просматриваемое видео канала должно стоять первым на первой
    // странице, а не быть лучшим из десяти случайных.
    expect(first.rows[0]?.viewCount).toBe(TOTAL * 100);
  });

  it("пустая выгрузка даёт одну страницу без строк", async () => {
    const channel = await makeChannel();
    const run = await makeFetchRun({ channelId: channel.id });

    const page = await videoPage(run.id, { prisma: testPrisma });

    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.pageCount).toBe(1);
  });

  it("выгрузка меньше самого мелкого размера умещается на одной странице", async () => {
    const channel = await makeChannel();
    const run = await makeFetchRun({ channelId: channel.id });
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });

    const page = await videoPage(run.id, {
      prisma: testPrisma,
      page: { page: 1, pageSize: MIN_PAGE_SIZE },
    });

    expect(page.pageCount).toBe(1);
    expect(page.rows).toHaveLength(1);
  });
});
