/**
 * @vitest-environment node
 *
 * Снимок проверяется по файлу на диске, а не по намерениям кода: обещание
 * тут именно в том, что `.xlsx` есть, открывается и содержит те же строки,
 * что и таблица. Окружение node, а не jsdom, — как и в проверке книги:
 * ExcelJS в браузерной сборке работает иначе.
 */

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSnapshot } from "@/lib/export/snapshot";
import { runJob, createRun } from "@/lib/fetch-job";
import { resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const FETCHED = new Date(Date.UTC(2026, 8, 21, 14, 21, 5));

/** Папка снимков на один тест: настоящий архив пользователя трогать нельзя. */
let history: string;

beforeEach(async () => {
  await resetDb();
  history = await mkdtemp(path.join(tmpdir(), "yt-history-"));
  vi.stubEnv("HISTORY_DIR", history);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(history, { recursive: true, force: true });
});

/** Файлы в папке снимков, по именам. */
async function snapshots(dir = history): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).sort();
}

/** Сколько строк с данными в книге — без строки заголовков. */
async function rowCount(file: string): Promise<number> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);

  const sheet = book.worksheets[0];
  if (sheet === undefined) throw new Error("в книге нет ни одного листа");
  return sheet.rowCount - 1;
}

/** Успешная выгрузка канала с заданным числом видео, уже лежащая в базе. */
async function storedRun(options: { videos: number; title?: string }): Promise<string> {
  const channel = await makeChannel({ title: options.title ?? "Канал про звук" });
  const run = await makeFetchRun({ channelId: channel.id, startedAt: FETCHED });

  for (let i = 0; i < options.videos; i += 1) {
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });
  }

  return run.id;
}

describe("снимок выгрузки в history/", () => {
  it("после выгрузки в папке лежит книга с теми же строками, что в таблице", async () => {
    const runId = await storedRun({ videos: 3 });

    const saved = await saveSnapshot(runId, { prisma: testPrisma });

    const files = await snapshots();
    expect(files).toHaveLength(1);
    expect(saved).not.toBeNull();
    expect(await rowCount(path.join(history, files[0] ?? ""))).toBe(3);
  });

  it("имя файла несёт идентификатор канала и время выгрузки", async () => {
    const runId = await storedRun({ videos: 1 });
    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: runId } });

    await saveSnapshot(runId, { prisma: testPrisma });

    const [file] = await snapshots();
    expect(file).toBe(`Канал про звук-${run.channelId}-2026-09-21_14-21-05.xlsx`);
  });

  it("путь к снимку запоминается в выгрузке", async () => {
    const runId = await storedRun({ videos: 1 });

    const saved = await saveSnapshot(runId, { prisma: testPrisma });

    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.snapshotPath).toBe(saved);
    // Разделитель один на всех: значение не должно зависеть от машины.
    expect(run.snapshotPath).not.toContain("\\");
  });

  it("папка создаётся сама, если её нет", async () => {
    // Ровно то, что происходит при первой выгрузке и после удаления архива.
    await rm(history, { recursive: true, force: true });
    const runId = await storedRun({ videos: 1 });

    await saveSnapshot(runId, { prisma: testPrisma });

    expect(await snapshots()).toHaveLength(1);
  });

  it("вторая выгрузка того же канала не затирает первый снимок", async () => {
    const channel = await makeChannel({ title: "Канал про звук" });

    const first = await makeFetchRun({ channelId: channel.id, startedAt: FETCHED });
    const second = await makeFetchRun({
      channelId: channel.id,
      startedAt: new Date(Date.UTC(2026, 8, 22, 9, 0, 0)),
    });
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: first.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: second.id });

    await saveSnapshot(first.id, { prisma: testPrisma });
    await saveSnapshot(second.id, { prisma: testPrisma });

    const files = await snapshots();
    expect(files).toHaveLength(2);
    expect(files[0]).toContain("2026-09-21_14-21-05");
    expect(files[1]).toContain("2026-09-22_09-00-00");
  });

  it("две выгрузки в одну и ту же секунду тоже не сливаются в один файл", async () => {
    // Секунда — предел точности имени, и на ней имена совпали бы.
    // Файл при этом всё равно не должен затираться молча.
    const channel = await makeChannel({ title: "Канал про звук" });
    const first = await makeFetchRun({ channelId: channel.id, startedAt: FETCHED });
    const second = await makeFetchRun({ channelId: channel.id, startedAt: FETCHED });
    const video = await makeVideo({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: first.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: second.id });

    await saveSnapshot(first.id, { prisma: testPrisma });
    await saveSnapshot(second.id, { prisma: testPrisma });

    expect(await snapshots()).toHaveLength(2);
  });

  it("несуществующая выгрузка снимка не оставляет", async () => {
    expect(await saveSnapshot("нет-такой-выгрузки", { prisma: testPrisma })).toBeNull();
    expect(await snapshots()).toHaveLength(0);
  });

  it("невозможность записать файл не бросается наружу", async () => {
    // Вместо папки — файл: так выглядит и снятое право на запись, и полный
    // диск. Снимок побочный, ронять из-за него выгрузку нечем.
    await rm(history, { recursive: true, force: true });
    await writeFile(history, "это не папка");
    const runId = await storedRun({ videos: 1 });

    await expect(saveSnapshot(runId, { prisma: testPrisma })).resolves.toBeNull();

    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.snapshotPath).toBeNull();
    await rm(history, { force: true });
  });
});

/** Канал из двух видео: одна страница списка. */
const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb"];
const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const UPLOADS = "UUX6OQ3DkcsbYNE6H8uQQuVA";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const PLAYLIST_ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const SHORTS_PAGE = "https://www.youtube.com/shorts/:id";

function mockChannel(options: { failList?: boolean } = {}): void {
  server.use(
    http.get(CHANNELS, () =>
      HttpResponse.json({
        items: [
          {
            id: CHANNEL_ID,
            snippet: { title: "Канал про звук", customUrl: "@sound", thumbnails: {} },
            contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
          },
        ],
      }),
    ),

    http.get(PLAYLIST_ITEMS, () => {
      if (options.failList === true) {
        return HttpResponse.json(
          { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        );
      }
      return HttpResponse.json({
        items: ids.map((id) => ({ contentDetails: { videoId: id } })),
        pageInfo: { totalResults: ids.length },
      });
    }),

    http.get(VIDEOS, ({ request }) => {
      const requested = (new URL(request.url).searchParams.get("id") ?? "").split(",");
      return HttpResponse.json({
        items: requested.map((id) => ({
          id,
          snippet: {
            title: "Видео",
            description: "",
            publishedAt: new Date(Date.UTC(2026, 0, 1, 12, 0)).toISOString(),
          },
          contentDetails: { duration: "PT10M" },
          statistics: { viewCount: "100", likeCount: "10", commentCount: "1" },
        })),
      });
    }),

    http.head(SHORTS_PAGE, () => new HttpResponse(null, { status: 404 })),
  );
}

describe("снимок по итогам настоящей выгрузки", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
    resetQuotaCounter();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("успешная выгрузка оставляет файл и помнит путь к нему", async () => {
    mockChannel();

    const started = await createRun("https://www.youtube.com/@sound", { prisma: testPrisma });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await runJob(started.runId, { prisma: testPrisma });

    const files = await snapshots();
    expect(files).toHaveLength(1);
    expect(await rowCount(path.join(history, files[0] ?? ""))).toBe(ids.length);

    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: started.runId } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.snapshotPath).not.toBeNull();
  });

  it("прерванная выгрузка снимка не оставляет", async () => {
    // В файле оказался бы обрывок канала, на диске неотличимый от полного среза.
    mockChannel({ failList: true });

    const started = await createRun("https://www.youtube.com/@sound", { prisma: testPrisma });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await runJob(started.runId, { prisma: testPrisma });

    const run = await testPrisma.fetchRun.findUniqueOrThrow({ where: { id: started.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.snapshotPath).toBeNull();
    expect(await snapshots()).toHaveLength(0);
  });
});
