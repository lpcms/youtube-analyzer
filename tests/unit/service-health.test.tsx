import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceBanner } from "@/app/service-banner";
import {
  QUOTA_LIMIT,
  healthMessage,
  healthTone,
  quotaMessage,
  type ServiceHealth,
} from "@/lib/service-health";
import { readServiceHealth } from "@/lib/service-status";
import { resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { makeChannel, makeFetchRun } from "../db/fixtures";
import { resetDb } from "../db/reset";

/**
 * Состояние сервиса.
 *
 * Пользователь должен узнавать о незаданном ключе и исчерпанной квоте
 * до того, как нажал «Начать», а не после.
 */

function health(over: Partial<ServiceHealth> = {}): ServiceHealth {
  return { keyConfigured: true, lastRun: null, quotaSpent: 0, ...over };
}

const failedWith = (reason: string): ServiceHealth =>
  health({ lastRun: { status: "FAILED", errorReason: reason } });

describe("насколько всё плохо", () => {
  it("свежий сервис с ключом — в порядке", () => {
    expect(healthTone(health())).toBe("ok");
    expect(healthMessage(health())).toBe("Сервис готов к работе");
  });

  it("успешная выгрузка не портит картину", () => {
    const ok = health({ lastRun: { status: "SUCCEEDED", errorReason: null } });

    expect(healthTone(ok)).toBe("ok");
    expect(healthMessage(ok)).toBe("Сервис работает");
  });

  it("незаданный ключ — поломка, которую чинит настройка", () => {
    const broken = health({ keyConfigured: false });

    expect(healthTone(broken)).toBe("error");
    expect(healthMessage(broken)).toContain(".env");
  });

  it("незаданный ключ важнее удачной прошлой выгрузки", () => {
    // Ключ могли убрать из .env после неё — работать сервис уже не будет.
    const broken = health({
      keyConfigured: false,
      lastRun: { status: "SUCCEEDED", errorReason: null },
    });

    expect(healthTone(broken)).toBe("error");
  });

  it("исчерпанная квота — предупреждение, а не поломка", () => {
    const quota = failedWith("quota-exceeded");

    // К завтрашнему дню пройдёт само, и пугать красным незачем.
    expect(healthTone(quota)).toBe("warn");
    expect(healthMessage(quota)).toContain("квота");
  });

  it("непринятый ключ — поломка: сам не починится", () => {
    expect(healthTone(failedWith("bad-key"))).toBe("error");
    expect(healthTone(failedWith("missing-key"))).toBe("error");
  });

  it("молчащая сеть — предупреждение", () => {
    const offline = failedWith("network");

    expect(healthTone(offline)).toBe("warn");
    expect(healthMessage(offline)).toContain("связи");
  });

  it("прерванная выгрузка тоже видна", () => {
    const partial = health({ lastRun: { status: "PARTIAL", errorReason: "quota-exceeded" } });

    expect(healthTone(partial)).toBe("warn");
  });

  it("незнакомая причина не показывается кодом", () => {
    const weird = failedWith("zzz-unknown");

    expect(healthTone(weird)).toBe("warn");
    expect(healthMessage(weird)).not.toContain("zzz-unknown");
  });

  it("расход квоты назван с пределом", () => {
    // Единица названа прямо: «137 из 10 000» без неё читается как штуки
    // видео или запросы, а это условные единицы YouTube.
    expect(quotaMessage(health({ quotaSpent: 137 }))).toBe("Квота: 137 из 10 000 единиц");
    expect(QUOTA_LIMIT).toBe(10_000);
  });
});

describe("строка состояния на экране", () => {
  it("сообщает состояние словом, а не одним цветом", () => {
    render(<ServiceBanner health={health()} />);

    // Различать жёлтое и красное умеют не все — слово читает каждый.
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Готов");
    expect(banner).toHaveTextContent("Сервис готов к работе");
  });

  it("незаданный ключ показывается как поломка", () => {
    render(<ServiceBanner health={health({ keyConfigured: false })} />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Не работает");
    expect(banner).toHaveAttribute("data-tone", "error");
  });

  it("исчерпанная квота показывается предупреждением", () => {
    render(<ServiceBanner health={failedWith("quota-exceeded")} />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Внимание");
    expect(banner).toHaveAttribute("data-tone", "warn");
  });

  it("расход квоты виден с пояснением", () => {
    render(<ServiceBanner health={health({ quotaSpent: 42 })} />);

    const quota = screen.getByText(/Квота: 42/);
    expect(quota).toBeInTheDocument();
    // Счётчик считает с запуска сервера — выдавать его за точный остаток нельзя.
    expect(quota).toHaveAttribute("title", expect.stringContaining("запуска сервера"));
  });

  it("сам ключ на страницу не попадает", () => {
    // В состоянии есть только признак «задан», значения ключа в нём нет
    // ни при каком раскладе.
    const { container } = render(<ServiceBanner health={health({ keyConfigured: true })} />);

    expect(Object.keys(health())).toEqual(["keyConfigured", "lastRun", "quotaSpent"]);
    expect(container.textContent).not.toMatch(/AIza/);
  });
});

describe("сбор состояния из базы и окружения", () => {
  beforeEach(async () => {
    await resetDb();
    resetQuotaCounter();
    vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("пустая база — выгрузок ещё не было", async () => {
    const result = await readServiceHealth({ prisma: testPrisma });

    expect(result.keyConfigured).toBe(true);
    expect(result.lastRun).toBeNull();
    expect(healthMessage(result)).toBe("Сервис готов к работе");
  });

  it("пустая переменная окружения видна без обращения к API", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");

    const result = await readServiceHealth({ prisma: testPrisma });

    expect(result.keyConfigured).toBe(false);
    expect(healthTone(result)).toBe("error");
  });

  it("берётся последняя по времени выгрузка, а не первая попавшаяся", async () => {
    const channel = await makeChannel();
    await makeFetchRun({
      channelId: channel.id,
      status: "SUCCEEDED",
      startedAt: new Date(Date.UTC(2026, 8, 20, 10, 0)),
    });
    await makeFetchRun({
      channelId: channel.id,
      status: "PARTIAL",
      errorReason: "quota-exceeded",
      startedAt: new Date(Date.UTC(2026, 8, 21, 10, 0)),
    });

    const result = await readServiceHealth({ prisma: testPrisma });

    expect(result.lastRun).toEqual({ status: "PARTIAL", errorReason: "quota-exceeded" });
    expect(healthTone(result)).toBe("warn");
  });

  it("уже известная выгрузка принимается без похода в базу", async () => {
    const result = await readServiceHealth({
      prisma: testPrisma,
      lastRun: { status: "FAILED", errorReason: "network" },
    });

    // В базе пусто, а состояние всё равно знает про сбой: значит, взято
    // из переданного, а не вычитано заново.
    expect(result.lastRun).toEqual({ status: "FAILED", errorReason: "network" });
  });

  it("состояние не содержит самого ключа", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "AIzaSyD-СЕКРЕТНЫЙ-КЛЮЧ");

    const result = await readServiceHealth({ prisma: testPrisma });

    expect(JSON.stringify(result)).not.toContain("AIzaSyD");
  });
});
