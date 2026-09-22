/**
 * @vitest-environment node
 *
 * Сравнение двух выгрузок читает обе из SQLite. Окружение node: работа идёт
 * с настоящей базой, браузерное ей ни к чему.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { compareRuns, listRuns } from "@/lib/compare-runs";
import { testPrisma } from "../db/client";
import { channelId, makeChannel, makeFetchRun, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const EARLY = new Date(Date.UTC(2026, 8, 20, 10, 0));
const LATE = new Date(Date.UTC(2026, 8, 21, 10, 0));

beforeEach(async () => {
  await resetDb();
});

/** Канал с двумя снимками: видео и их метрики задаются по каждому снимку. */
async function twoRuns(options: {
  before: Record<string, [number | null, number | null, number | null]>;
  after: Record<string, [number | null, number | null, number | null]>;
  partialLater?: boolean;
}): Promise<{ channel: string; earlier: string; later: string }> {
  const channel = await makeChannel({ title: "Канал про звук" });

  const earlier = await makeFetchRun({ channelId: channel.id, startedAt: EARLY });
  const later = await makeFetchRun({
    channelId: channel.id,
    startedAt: LATE,
    // Ограничение по количеству — самый обычный неполный обход.
    ...(options.partialLater === true ? { requestedLimit: 3 } : {}),
  });

  const ids = new Set([...Object.keys(options.before), ...Object.keys(options.after)]);
  const videos = new Map<string, string>();

  let index = 0;
  for (const key of ids) {
    index += 1;
    const video = await makeVideo({
      channelId: channel.id,
      title: `Видео ${key}`,
      publishedAt: new Date(Date.UTC(2026, 2, index, 12, 0)),
    });
    videos.set(key, video.id);
  }

  const write = async (
    runId: string,
    rows: Record<string, [number | null, number | null, number | null]>,
  ): Promise<void> => {
    for (const [key, [views, likes, comments]] of Object.entries(rows)) {
      await makeVideoStat({
        videoId: videos.get(key) ?? "",
        fetchRunId: runId,
        viewCount: views,
        likeCount: likes,
        commentCount: comments,
      });
    }
  };

  await write(earlier.id, options.before);
  await write(later.id, options.after);

  return { channel: channel.id, earlier: earlier.id, later: later.id };
}

describe("список выгрузок канала", () => {
  it("свежие сверху, с числом строк в каждом снимке", async () => {
    const { channel, earlier, later } = await twoRuns({
      before: { a: [100, 10, 1], b: [200, 20, 2] },
      after: { a: [150, 10, 1] },
    });

    const runs = await listRuns(channel, { prisma: testPrisma });

    expect(runs.map((run) => run.id)).toEqual([later, earlier]);
    expect(runs.map((run) => run.rowCount)).toEqual([1, 2]);
    expect(runs.every((run) => run.complete)).toBe(true);
  });

  it("пустая выгрузка в списке не предлагается", async () => {
    // Сравнивать с ней нечего, а в списке дат она выглядела бы снимком.
    const { channel } = await twoRuns({ before: { a: [100, 10, 1] }, after: { a: [150, 10, 1] } });
    await makeFetchRun({ channelId: channel, startedAt: new Date(Date.UTC(2026, 8, 22, 10, 0)) });

    const runs = await listRuns(channel, { prisma: testPrisma });

    expect(runs).toHaveLength(2);
  });

  it("неполный обход назван неполным", async () => {
    const { channel } = await twoRuns({
      before: { a: [100, 10, 1] },
      after: { a: [150, 10, 1] },
      partialLater: true,
    });

    const runs = await listRuns(channel, { prisma: testPrisma });

    expect(runs[0]?.complete).toBe(false);
    expect(runs[1]?.complete).toBe(true);
  });

  it("чужие каналы в список не попадают", async () => {
    const { channel } = await twoRuns({ before: { a: [100, 10, 1] }, after: { a: [150, 10, 1] } });
    const stranger = await makeChannel({ title: "Соседний канал" });
    const run = await makeFetchRun({ channelId: stranger.id });
    const video = await makeVideo({ channelId: stranger.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });

    const runs = await listRuns(channel, { prisma: testPrisma });

    expect(runs).toHaveLength(2);
    expect(runs.some((r) => r.id === run.id)).toBe(false);
  });
});

describe("сравнение двух выгрузок", () => {
  it("читает оба снимка из базы и не обращается к API", async () => {
    // Незамоканный запрос валит тест: server.listen поднят с
    // onUnhandledRequest: "error", и ни один обработчик здесь не задан.
    expect(server.listHandlers()).toHaveLength(0);

    const { earlier, later } = await twoRuns({
      before: { a: [1000, 100, 10], b: [500, 50, 5] },
      after: { a: [1500, 90, 10], b: [400, 50, 5] },
    });

    const result = await compareRuns(earlier, later, { prisma: testPrisma });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comparison.counts).toEqual({ compared: 2, added: 0, gone: 0 });
    expect(result.comparison.total).toBe(2);
  });

  it("порядок выбранных дат не меняет знак прироста", async () => {
    const { earlier, later } = await twoRuns({
      before: { a: [1000, 100, 10] },
      after: { a: [1500, 100, 10] },
    });

    const straight = await compareRuns(earlier, later, { prisma: testPrisma });
    const reversed = await compareRuns(later, earlier, { prisma: testPrisma });

    expect(straight.ok && straight.comparison.rows[0]?.views).toEqual({
      kind: "value",
      absolute: 500,
      ratio: 0.5,
    });
    // Ранний и поздний определяются по времени начала, а не по порядку
    // аргументов: иначе прирост менял бы знак от того, в какой список ткнули.
    expect(reversed.ok && reversed.comparison.rows[0]?.views).toEqual({
      kind: "value",
      absolute: 500,
      ratio: 0.5,
    });
    expect(straight.ok && straight.comparison.before.id).toBe(earlier);
    expect(reversed.ok && reversed.comparison.before.id).toBe(earlier);
  });

  it("появившиеся и исчезнувшие видео помечены, а не потеряны", async () => {
    const { earlier, later } = await twoRuns({
      before: { held: [1000, 100, 10], lost: [300, 30, 3] },
      after: { held: [1200, 100, 10], fresh: [700, 70, 7] },
    });

    const result = await compareRuns(earlier, later, { prisma: testPrisma });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byPresence = Object.fromEntries(
      result.comparison.rows.map((row) => [row.title, row.presence]),
    );
    expect(byPresence).toEqual({
      "Видео held": "both",
      "Видео lost": "gone",
      "Видео fresh": "new",
    });
    expect(result.comparison.counts).toEqual({ compared: 1, added: 1, gone: 1 });
  });

  it("скрытая метрика даёт «н/д», а не прирост", async () => {
    const { earlier, later } = await twoRuns({
      before: { a: [1000, null, 10] },
      after: { a: [1200, 50, 10] },
    });

    const result = await compareRuns(earlier, later, { prisma: testPrisma });

    expect(result.ok && result.comparison.rows[0]?.likes).toEqual({ kind: "hidden" });
  });

  it("неполный снимок с обеих сторон виден по флагу", async () => {
    const complete = await twoRuns({ before: { a: [1, 1, 1] }, after: { a: [2, 1, 1] } });
    const partial = await twoRuns({
      before: { a: [1, 1, 1] },
      after: { a: [2, 1, 1] },
      partialLater: true,
    });

    const first = await compareRuns(complete.earlier, complete.later, { prisma: testPrisma });
    const second = await compareRuns(partial.earlier, partial.later, { prisma: testPrisma });

    expect(first.ok && first.comparison.partial).toBe(false);
    expect(second.ok && second.comparison.partial).toBe(true);
  });

  it("страница отрезается от сведённых строк", async () => {
    const before: Record<string, [number, number, number]> = {};
    const after: Record<string, [number, number, number]> = {};
    for (let i = 0; i < 7; i += 1) {
      before[`v${i}`] = [100 * (i + 1), 10, 1];
      after[`v${i}`] = [200 * (i + 1), 10, 1];
    }

    const { earlier, later } = await twoRuns({ before, after });

    const result = await compareRuns(earlier, later, {
      prisma: testPrisma,
      page: { page: 2, pageSize: 3 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comparison.rows).toHaveLength(3);
    expect(result.comparison.total).toBe(7);
    expect(result.comparison.pageCount).toBe(3);
  });

  it("страница за краем возвращается к последней", async () => {
    const { earlier, later } = await twoRuns({
      before: { a: [1, 1, 1] },
      after: { a: [2, 1, 1] },
    });

    const result = await compareRuns(earlier, later, {
      prisma: testPrisma,
      page: { page: 99, pageSize: 50 },
    });

    expect(result.ok && result.comparison.page).toBe(1);
  });

  it("снимок сам с собой не сравнивается", async () => {
    const { later } = await twoRuns({ before: { a: [1, 1, 1] }, after: { a: [2, 1, 1] } });

    const result = await compareRuns(later, later, { prisma: testPrisma });

    expect(result).toEqual({ ok: false, reason: "same-run" });
  });

  it("выгрузки разных каналов сравнивать нельзя", async () => {
    const mine = await twoRuns({ before: { a: [1, 1, 1] }, after: { a: [2, 1, 1] } });
    const stranger = await makeChannel({ id: channelId("z"), title: "Соседний канал" });
    const run = await makeFetchRun({ channelId: stranger.id });

    const result = await compareRuns(mine.later, run.id, { prisma: testPrisma });

    expect(result).toEqual({ ok: false, reason: "other-channel" });
  });

  it("несуществующая выгрузка объясняется, а не падает", async () => {
    const { later } = await twoRuns({ before: { a: [1, 1, 1] }, after: { a: [2, 1, 1] } });

    const result = await compareRuns(later, "нет-такой-выгрузки", { prisma: testPrisma });

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
