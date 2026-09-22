import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteChannel, listChannels } from "@/lib/channel-history";
import {
  EMPTY_HISTORY,
  countsLine,
  fetchedLine,
  snapshotNote,
  summaryLine,
  totalVideos,
  type ChannelSummary,
} from "@/lib/channel-summary";
import { videoPage } from "@/lib/fetch-channel";
import { latestRun } from "@/lib/fetch-channel";
import { jobProgress } from "@/lib/fetch-job";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun, makeShort, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

/**
 * История каналов.
 *
 * Вернуться к уже проанализированному каналу — самое частое действие после
 * первой выгрузки, и стоить квоты оно не должно.
 */

function summary(over: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id: "UC1",
    title: "Канал",
    handle: "@channel",
    videoCount: 12,
    shortsCount: 5,
    lastFetchedAt: new Date(Date.UTC(2026, 8, 21, 14, 21)),
    latestRunId: "run-1",
    runCount: 1,
    ...over,
  };
}

describe("строка канала в списке", () => {
  it("называет оба счётчика и дату последней выгрузки", () => {
    expect(summaryLine(summary())).toBe("12 Video · 5 Shorts · выгружено 2026-09-21 14:21");
  });

  it("нулевой счётчик всё равно назван", () => {
    // «12 Video» без второго числа оставляет вопрос, искали ли Shorts вообще.
    expect(countsLine(summary({ shortsCount: 0 }))).toBe("12 Video · 0 Shorts");
  });

  it("число снимков упоминается, только когда их больше одного", () => {
    expect(summaryLine(summary({ runCount: 1 }))).not.toContain("снимков");
    expect(summaryLine(summary({ runCount: 4 }))).toContain("снимков: 4");
  });

  it("канал без завершённой выгрузки говорит об этом словами", () => {
    expect(fetchedLine(summary({ lastFetchedAt: null }))).toBe("выгрузка не завершалась");
  });

  it("дата берётся в UTC, а не по часам машины", () => {
    const line = fetchedLine(summary({ lastFetchedAt: new Date(Date.UTC(2026, 0, 1, 0, 30)) }));

    expect(line).toBe("выгружено 2026-01-01 00:30");
  });

  it("всего видео — сумма обоих типов", () => {
    expect(totalVideos(summary())).toBe(17);
  });

  it("пустая история объясняет, а не показывает пустой список", () => {
    expect(EMPTY_HISTORY).toContain("Выгрузок ещё не было");
    expect(EMPTY_HISTORY).toContain("Начать");
  });
});

describe("подпись над таблицей", () => {
  it("называет канал и дату сбора", () => {
    expect(snapshotNote("Мой канал", new Date(Date.UTC(2026, 8, 21, 14, 21)))).toBe(
      "Канал «Мой канал» · данные собраны 2026-09-21 14:21",
    );
  });

  it("незавершённая выгрузка датой не хвастается", () => {
    expect(snapshotNote("Мой канал", null)).toBe("Канал «Мой канал»");
  });
});

describe("список каналов из базы", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("пустая база даёт пустой список, а не ошибку", async () => {
    await expect(listChannels({ prisma: testPrisma })).resolves.toEqual([]);
  });

  it("считает Video и Shorts по отдельности", async () => {
    const channel = await makeChannel({ title: "Канал А" });
    await makeVideo({ channelId: channel.id });
    await makeVideo({ channelId: channel.id });
    await makeShort({ channelId: channel.id });

    const [row] = await listChannels({ prisma: testPrisma });

    expect(row?.videoCount).toBe(2);
    expect(row?.shortsCount).toBe(1);
  });

  it("исчезнувшие видео в счёт не идут", async () => {
    const channel = await makeChannel();
    await makeVideo({ channelId: channel.id });
    await makeVideo({ channelId: channel.id, goneAt: new Date() });

    const [row] = await listChannels({ prisma: testPrisma });

    // Список показывает, что на канале есть, а не что когда-либо было.
    expect(row?.videoCount).toBe(1);
  });

  it("чужие видео не попадают в счёт канала", async () => {
    const mine = await makeChannel({ title: "Мой" });
    const other = await makeChannel({ title: "Чужой" });
    await makeVideo({ channelId: mine.id });
    await makeShort({ channelId: other.id });
    await makeShort({ channelId: other.id });

    const rows = await listChannels({ prisma: testPrisma });
    const byTitle = new Map(rows.map((r) => [r.title, r]));

    expect(byTitle.get("Мой")?.videoCount).toBe(1);
    expect(byTitle.get("Мой")?.shortsCount).toBe(0);
    expect(byTitle.get("Чужой")?.shortsCount).toBe(2);
  });

  it("свежие каналы сверху, невыгруженные — в конце", async () => {
    await makeChannel({ title: "Старый", lastFetchedAt: new Date(Date.UTC(2026, 0, 1)) });
    await makeChannel({ title: "Свежий", lastFetchedAt: new Date(Date.UTC(2026, 8, 21)) });
    await makeChannel({ title: "Ни разу", lastFetchedAt: null });

    const rows = await listChannels({ prisma: testPrisma });

    expect(rows.map((r) => r.title)).toEqual(["Свежий", "Старый", "Ни разу"]);
  });

  it("даёт последнюю выгрузку и общее число снимков", async () => {
    const channel = await makeChannel();
    await makeFetchRun({ channelId: channel.id, startedAt: new Date(Date.UTC(2026, 8, 20, 10)) });
    const newest = await makeFetchRun({
      channelId: channel.id,
      startedAt: new Date(Date.UTC(2026, 8, 21, 10)),
    });

    const [row] = await listChannels({ prisma: testPrisma });

    expect(row?.latestRunId).toBe(newest.id);
    expect(row?.runCount).toBe(2);
  });

  it("канал без выгрузок открывать нечем", async () => {
    await makeChannel();

    const [row] = await listChannels({ prisma: testPrisma });

    expect(row?.latestRunId).toBeNull();
  });
});

describe("открытие канала из истории", () => {
  /** Ловушка на любой вызов YouTube: он здесь не должен случиться вовсе. */
  function trapApiCalls(): () => string[] {
    const calls: string[] = [];
    server.use(
      http.get("https://www.googleapis.com/youtube/v3/*", ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json({});
      }),
      http.head("https://www.youtube.com/shorts/:id", ({ request }) => {
        calls.push(request.url);
        return new HttpResponse(null, { status: 404 });
      }),
    );
    return () => calls;
  }

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("не делает ни одного обращения к API", async () => {
    const calls = trapApiCalls();

    const channel = await makeChannel({ title: "Канал из истории" });
    const run = await makeFetchRun({ channelId: channel.id });
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id, viewCount: 4242 });

    // Ровно то, что делает страница при открытии канала из списка.
    const [row] = await listChannels({ prisma: testPrisma });
    const runId = await latestRun(channel.id, { prisma: testPrisma });
    const progress = await jobProgress(runId ?? "", { prisma: testPrisma });
    const page = await videoPage(runId ?? "", { prisma: testPrisma });

    expect(row?.latestRunId).toBe(run.id);
    expect(page.rows[0]?.viewCount).toBe(4242);
    expect(progress?.channelTitle).toBe("Канал из истории");
    expect(calls()).toEqual([]);
  });

  it("подпись над таблицей знает канал и дату сбора", async () => {
    const channel = await makeChannel({ title: "Канал из истории" });
    const run = await makeFetchRun({
      channelId: channel.id,
      finishedAt: new Date(Date.UTC(2026, 8, 21, 14, 21)),
    });
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });

    const progress = await jobProgress(run.id, { prisma: testPrisma });

    expect(snapshotNote(progress!.channelTitle, progress!.fetchedAt)).toBe(
      "Канал «Канал из истории» · данные собраны 2026-09-21 14:21",
    );
  });
});

describe("удаление канала из истории", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("уносит с собой видео и снимки этого канала", async () => {
    const channel = await makeChannel();
    const run = await makeFetchRun({ channelId: channel.id });
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });

    await expect(deleteChannel(channel.id, { prisma: testPrisma })).resolves.toBe(true);

    await expect(testPrisma.channel.count()).resolves.toBe(0);
    await expect(testPrisma.video.count()).resolves.toBe(0);
    await expect(testPrisma.videoStat.count()).resolves.toBe(0);
    await expect(testPrisma.fetchRun.count()).resolves.toBe(0);
  });

  it("не задевает соседний канал", async () => {
    const doomed = await makeChannel({ title: "Под удаление" });
    const spared = await makeChannel({ title: "Уцелевший" });

    const doomedRun = await makeFetchRun({ channelId: doomed.id });
    const sparedRun = await makeFetchRun({ channelId: spared.id });
    const doomedVideo = await makeVideo({ channelId: doomed.id });
    const sparedVideo = await makeVideo({ channelId: spared.id });
    await makeVideoStat({ videoId: doomedVideo.id, fetchRunId: doomedRun.id });
    await makeVideoStat({ videoId: sparedVideo.id, fetchRunId: sparedRun.id });

    await deleteChannel(doomed.id, { prisma: testPrisma });

    const left = await listChannels({ prisma: testPrisma });
    expect(left.map((c) => c.title)).toEqual(["Уцелевший"]);
    await expect(testPrisma.video.count()).resolves.toBe(1);
    await expect(testPrisma.videoStat.count()).resolves.toBe(1);
    // Таблица уцелевшего канала по-прежнему читается.
    const page = await videoPage(sparedRun.id, { prisma: testPrisma });
    expect(page.total).toBe(1);
  });

  it("повторное удаление — не ошибка", async () => {
    const channel = await makeChannel();

    await expect(deleteChannel(channel.id, { prisma: testPrisma })).resolves.toBe(true);
    // Обычная вторая вкладка, а не поломка.
    await expect(deleteChannel(channel.id, { prisma: testPrisma })).resolves.toBe(false);
  });

  it("удаление несуществующего канала ничего не ломает", async () => {
    await makeChannel();

    await expect(deleteChannel("UCнетакого", { prisma: testPrisma })).resolves.toBe(false);
    await expect(testPrisma.channel.count()).resolves.toBe(1);
  });
});
