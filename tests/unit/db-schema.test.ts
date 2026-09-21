import { beforeEach, describe, expect, it } from "vitest";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun, makeShort, makeVideo, makeVideoStat } from "../db/fixtures";
import { resetDb } from "../db/reset";

beforeEach(async () => {
  await resetDb();
});

describe("изоляция тестовой базы", () => {
  // Два теста подряд, каждый создающий канал: если база общая с dev.db
  // или не чистится, второй увидит чужую строку.
  it("первый тест видит только свой канал", async () => {
    await makeChannel({ title: "Первый" });

    await expect(testPrisma.channel.count()).resolves.toBe(1);
  });

  it("второй тест видит только свой канал", async () => {
    await makeChannel({ title: "Второй" });

    const channels = await testPrisma.channel.findMany();
    expect(channels).toHaveLength(1);
    expect(channels[0]?.title).toBe("Второй");
  });
});

describe("ряд наблюдений во времени", () => {
  it("две выгрузки одного канала сохраняются как два набора статистики", async () => {
    const channel = await makeChannel();
    const video = await makeVideo({ channelId: channel.id });

    const june = await makeFetchRun({
      channelId: channel.id,
      startedAt: new Date(Date.UTC(2026, 5, 1, 10, 0)),
    });
    const september = await makeFetchRun({
      channelId: channel.id,
      startedAt: new Date(Date.UTC(2026, 8, 21, 14, 0)),
    });

    await makeVideoStat({ videoId: video.id, fetchRunId: june.id, viewCount: 1_000 });
    await makeVideoStat({ videoId: video.id, fetchRunId: september.id, viewCount: 4_500 });

    const runs = await testPrisma.fetchRun.findMany({ where: { channelId: channel.id } });
    expect(runs).toHaveLength(2);

    const stats = await testPrisma.videoStat.findMany({
      where: { videoId: video.id },
      orderBy: { fetchRun: { startedAt: "asc" } },
    });
    expect(stats.map((s) => s.viewCount)).toEqual([1_000, 4_500]);
  });

  it("не позволяет записать статистику видео дважды за одну выгрузку", async () => {
    const channel = await makeChannel();
    const video = await makeVideo({ channelId: channel.id });
    const run = await makeFetchRun({ channelId: channel.id });

    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });

    await expect(makeVideoStat({ videoId: video.id, fetchRunId: run.id })).rejects.toThrow();
  });

  it("отличает скрытую статистику от нуля", async () => {
    const channel = await makeChannel();
    const video = await makeVideo({ channelId: channel.id });
    const run = await makeFetchRun({ channelId: channel.id });

    const hidden = await makeVideoStat({
      videoId: video.id,
      fetchRunId: run.id,
      likeCount: null,
      commentCount: 0,
    });

    expect(hidden.likeCount).toBeNull();
    expect(hidden.commentCount).toBe(0);
  });
});

describe("удаление канала", () => {
  it("уводит за собой видео, выгрузки и статистику", async () => {
    const channel = await makeChannel();
    const video = await makeVideo({ channelId: channel.id });
    const run = await makeFetchRun({ channelId: channel.id });
    await makeVideoStat({ videoId: video.id, fetchRunId: run.id });

    await testPrisma.channel.delete({ where: { id: channel.id } });

    await expect(testPrisma.video.count()).resolves.toBe(0);
    await expect(testPrisma.fetchRun.count()).resolves.toBe(0);
    await expect(testPrisma.videoStat.count()).resolves.toBe(0);
  });

  it("не задевает видео соседнего канала", async () => {
    const doomed = await makeChannel();
    const survivor = await makeChannel();
    await makeVideo({ channelId: doomed.id });
    const kept = await makeShort({ channelId: survivor.id });

    await testPrisma.channel.delete({ where: { id: doomed.id } });

    const videos = await testPrisma.video.findMany();
    expect(videos).toHaveLength(1);
    expect(videos[0]?.id).toBe(kept.id);
  });
});

describe("фабрики", () => {
  it("makeShort даёт видео короче порога Shorts, makeVideo — длиннее", async () => {
    const channel = await makeChannel();
    const short = await makeShort({ channelId: channel.id });
    const video = await makeVideo({ channelId: channel.id });

    expect(short.kind).toBe("SHORTS");
    expect(short.durationSec).toBeLessThanOrEqual(180);
    expect(video.kind).toBe("VIDEO");
    expect(video.durationSec).toBeGreaterThan(180);
  });

  it("позволяет переопределить любое поле", async () => {
    const channel = await makeChannel({ title: "Свой заголовок", handle: "@custom" });

    expect(channel.title).toBe("Свой заголовок");
    expect(channel.handle).toBe("@custom");
    expect(channel.uploadsPlaylistId.startsWith("UU")).toBe(true);
  });
});
