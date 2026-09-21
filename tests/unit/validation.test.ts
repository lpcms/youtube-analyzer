import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startJob } from "@/lib/fetch-job";
import {
  parseCount,
  readForm,
  validateRequest,
  type FieldErrors,
  type RawRequest,
} from "@/lib/request-schema";
import { resetQuotaCounter } from "@/lib/youtube/api";
import { testPrisma } from "../db/client";
import { resetDb } from "../db/reset";
import { server } from "../msw/server";

const VALID_URL = "https://www.youtube.com/@MrBeast";

/** Заведомо верный набор — в тестах меняется одно поле за раз. */
function raw(overrides: Partial<RawRequest> = {}): RawRequest {
  return {
    channelUrl: VALID_URL,
    count: "50",
    allVideos: true,
    includeVideos: true,
    includeShorts: true,
    ...overrides,
  };
}

function errorsOf(input: RawRequest): FieldErrors {
  const result = validateRequest(input);
  return result.ok ? {} : result.errors;
}

describe("разбор количества", () => {
  const good: ReadonlyArray<readonly [string, number]> = [
    ["1", 1],
    ["50", 50],
    ["  12  ", 12],
    ["1000000", 1_000_000],
  ];

  it.each(good)("«%s» → %d", (input, expected) => {
    expect(parseCount(input)).toBe(expected);
  });

  const bad = ["", "   ", "0", "-5", "3.5", "12abc", "abc", "1e3", "٣", "Infinity", "NaN"];

  it.each(bad)("«%s» отклоняется", (input) => {
    // Number(" ") даёт 0, Number("1e3") — 1000: без строгой проверки
    // такие строки просочились бы как валидные.
    expect(parseCount(input)).toBeNull();
  });
});

describe("проверка запроса: валидные наборы", () => {
  it("адрес и «все видео» — самый обычный запрос", () => {
    const result = validateRequest(raw());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.limit).toBeNull();
      expect(result.request.includeVideos).toBe(true);
      expect(result.request.includeShorts).toBe(true);
    }
  });

  it("количество вместо «всех»", () => {
    const result = validateRequest(raw({ allVideos: false, count: "25" }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.limit).toBe(25);
  });

  it("один тип из двух", () => {
    const result = validateRequest(raw({ includeVideos: false }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.includeVideos).toBe(false);
      expect(result.request.includeShorts).toBe(true);
    }
  });

  it("мусор в количестве не мешает, когда выбрано «все видео»", () => {
    // Поле погашено галочкой, его значение не используется.
    const result = validateRequest(raw({ allVideos: true, count: "не число" }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.limit).toBeNull();
  });

  it("адрес очищается от окружающих пробелов", () => {
    const result = validateRequest(raw({ channelUrl: "  " + VALID_URL + "  " }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.channelUrl).toBe(VALID_URL);
  });
});

describe("проверка запроса: отклоняемые наборы", () => {
  it("пустой адрес", () => {
    expect(errorsOf(raw({ channelUrl: "" })).channelUrl).toBe("Введите адрес канала");
  });

  it("только пробелы в адресе", () => {
    expect(errorsOf(raw({ channelUrl: "   " })).channelUrl).toBe("Введите адрес канала");
  });

  it("чужой домен", () => {
    expect(errorsOf(raw({ channelUrl: "https://vimeo.com/@x" })).channelUrl).toBe(
      "Это не адрес канала YouTube",
    );
  });

  it("youtube.com, но не страница канала", () => {
    expect(errorsOf(raw({ channelUrl: "https://www.youtube.com/watch?v=x" })).channelUrl).toBe(
      "Адрес не похож на страницу канала",
    );
  });

  const badCounts = ["0", "-5", "3.5", "abc", ""];

  it.each(badCounts)("количество «%s» отклоняется с сообщением", (count) => {
    expect(errorsOf(raw({ allVideos: false, count })).count).toBe(
      "Количество — целое число больше нуля",
    );
  });

  it("обе галочки сняты", () => {
    expect(errorsOf(raw({ includeVideos: false, includeShorts: false })).types).toBe(
      "Выберите хотя бы один тип: Video или Shorts",
    );
  });

  it("несколько ошибок сразу, а не по одной", () => {
    // Исправлять их поочерёдно, каждый раз перезапуская выгрузку, — худший
    // вид общения с формой.
    const errors = errorsOf(
      raw({
        channelUrl: "https://vimeo.com/@x",
        allVideos: false,
        count: "0",
        includeVideos: false,
        includeShorts: false,
      }),
    );

    expect(Object.keys(errors).sort()).toEqual(["channelUrl", "count", "types"]);
  });

  it("запрос мимо формы не роняет действие", () => {
    const result = validateRequest({ что: "то" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.channelUrl).toBeDefined();
  });
});

describe("чтение формы", () => {
  it("снятая галочка — это отсутствие ключа, а не строка", () => {
    const form = new FormData();
    form.set("channelUrl", VALID_URL);
    form.set("count", "10");
    form.set("includeVideos", "on");

    const parsed = readForm(form);

    expect(parsed.includeVideos).toBe(true);
    expect(parsed.includeShorts).toBe(false);
    expect(parsed.allVideos).toBe(false);
    expect(parsed.count).toBe("10");
  });
});

describe("проверка на сервере, а не только в форме", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("YOUTUBE_API_KEY", "тестовый-ключ");
    resetQuotaCounter();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("чужой домен не доходит до API и не заводит задание", async () => {
    let apiCalled = false;
    server.use(
      http.get("https://www.googleapis.com/youtube/v3/channels", () => {
        apiCalled = true;
        return HttpResponse.json({ items: [] });
      }),
    );

    const checked = validateRequest(raw({ channelUrl: "https://vimeo.com/@x" }));
    expect(checked.ok).toBe(false);

    // Даже если проверку обойти, задание не заводится: адрес не разбирается.
    const started = await startJob("https://vimeo.com/@x", { prisma: testPrisma });
    expect(started.ok).toBe(false);
    expect(apiCalled).toBe(false);
    await expect(testPrisma.fetchRun.count()).resolves.toBe(0);
  });

  it("обе галочки сняты — задание не заводится даже в обход формы", async () => {
    const started = await startJob(VALID_URL, {
      includeVideos: false,
      includeShorts: false,
      prisma: testPrisma,
    });

    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.failure.kind).toBe("no-types");
    await expect(testPrisma.fetchRun.count()).resolves.toBe(0);
  });
});
