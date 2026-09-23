import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FetchProgress } from "@/app/fetch-progress";
import type { FetchStatus, JobProgress } from "@/lib/job-status";

/**
 * Плашка хода выгрузки.
 *
 * Проверяется не красота, а два обещания: волчок крутится только пока идёт
 * работа, и цвет плашки не совпадает с зелёным светофором состояния сервиса,
 * иначе две соседние плашки слились бы в одну, хотя говорят о разном.
 */

function progress(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    status: "RUNNING" as FetchStatus,
    processed: 42,
    expected: 137,
    errorReason: null,
    vanished: 0,
    channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA",
    channelTitle: "Канал",
    fetchedAt: null,
    ...overrides,
  };
}

function show(overrides: Partial<JobProgress> = {}): HTMLElement {
  const { container } = render(<FetchProgress progress={progress(overrides)} />);
  const plate = container.querySelector("#fetch-progress");
  if (plate === null) throw new Error("плашка прогресса не отрисовалась");
  return plate as HTMLElement;
}

describe("плашка хода выгрузки", () => {
  it("во время работы крутит волчок", () => {
    const plate = show({ status: "RUNNING" });

    expect(plate.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("после завершения волчок убирается", () => {
    // Крутящийся волчок рядом с «Готово» означал бы, что что-то ещё идёт.
    const plate = show({ status: "SUCCEEDED", processed: 137 });

    expect(plate.querySelector("svg")).toBeNull();
    expect(plate).toHaveTextContent("Готово: 137");
  });

  it("волчок не озвучивается скринридеру", () => {
    // О ходе работы говорит сам текст плашки, он же под aria-live.
    const plate = show({ status: "RUNNING" });

    expect(plate.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(plate).toHaveAttribute("aria-live", "polite");
  });

  it("успешная выгрузка не зеленеет: зелёный занят состоянием сервиса", () => {
    const plate = show({ status: "SUCCEEDED", processed: 137 });

    expect(plate.className).toContain("indigo");
    expect(plate.className).not.toContain("emerald");
  });

  it("беда остаётся жёлтой и красной", () => {
    // Жёлтый и красный значат одно и то же у обеих плашек — это и правильно.
    expect(show({ status: "PARTIAL", processed: 50 }).className).toContain("amber");
    expect(show({ status: "FAILED", processed: 0 }).className).toContain("red");
  });
});

describe("единица измерения в счёте", () => {
  it("названа у каждого числа, а не только у первого", () => {
    // «Готово: 137» одинаково читается и как видео, и как секунды,
    // и как проценты.
    expect(show({ status: "SUCCEEDED", processed: 137 })).toHaveTextContent("Готово: 137 видео");
    expect(show({ status: "PARTIAL", processed: 50 })).toHaveTextContent(
      "Собрано 50 видео, выгрузка прервана",
    );
    expect(show({ status: "RUNNING", processed: 42, expected: 137 })).toHaveTextContent(
      "Получено 42 из ~137 видео",
    );
  });
});
