import { expect, test, type Page } from "@playwright/test";

/**
 * Отказы YouTube API глазами пользователя.
 *
 * Заглушка отдаёт два особых канала: на одном квота кончается посреди
 * выгрузки, на другом API не принимает ключ. Проверяется, что сервис
 * объясняется, а не падает, и что собранное до отказа остаётся на экране.
 */

/** Ключ, с которым работает дев-сервер во время прогона. */
const E2E_KEY = "e2e-ключ-не-настоящий";

const QUOTA_CHANNEL = "https://www.youtube.com/@e2e-quota";
const BAD_KEY_CHANNEL = "https://www.youtube.com/@e2e-badkey";
const GOOD_CHANNEL = "https://www.youtube.com/@e2e-gen1";

/** Собирает все ответы с пятисоткой: отказ API не должен превращаться в неё. */
function watchServerErrors(page: Page): () => string[] {
  const seen: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500) seen.push(`${response.status()} ${response.url()}`);
  });
  return () => seen;
}

/** Израсходованная квота из строки вида «Квота: 42 из 10000». */
async function spentQuota(page: Page): Promise<number> {
  const text = await page.locator("#quota-spent").innerText();
  const match = /Квота:\s*(\d+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`не разобрал расход квоты: ${text}`);
  return Number(match[1]);
}

async function start(page: Page, url: string): Promise<void> {
  await page.getByLabel("Адрес канала").fill(url);
  await page.getByRole("button", { name: "Начать" }).click();
}

test.describe("исчерпанная квота", () => {
  test("видно причину, уцелевшие строки и состояние сервиса", async ({ page }) => {
    const serverErrors = watchServerErrors(page);

    await page.goto("/");
    await start(page, QUOTA_CHANNEL);

    // Первая страница успела сохраниться до отказа — её и показываем.
    await expect(page.locator("tbody tr")).toHaveCount(50, { timeout: 60_000 });
    await expect(page.locator("#fetch-progress")).toContainText("Собрано 50 видео");

    const reason = page.getByText(/Причина остановки/);
    await expect(reason).toContainText("квота");
    // Код отказа — для журнала, а не для экрана.
    await expect(reason).not.toContainText("quota-exceeded");

    // Строка состояния запоминает: до обновления квоты выгрузок не будет.
    const banner = page.locator("#service-status");
    await expect(banner).toHaveAttribute("data-tone", "warn");
    await expect(banner).toContainText("Внимание");
    await expect(banner).toContainText("квота");

    // Штатная ситуация не должна выглядеть поломкой сервера.
    expect(serverErrors()).toEqual([]);
  });

  test("таблицу с уцелевшими строками можно листать и скачать", async ({ page }) => {
    await page.goto("/");
    await start(page, QUOTA_CHANNEL);
    await expect(page.locator("tbody tr")).toHaveCount(50, { timeout: 60_000 });

    // Частичный результат — полноценный: он не «черновик до полной выгрузки».
    await expect(page.locator("#row-count-top")).toHaveText(/из\s*50/);
    await expect(page.getByRole("link", { name: "Скачать таблицу" }).first()).toBeVisible();
  });
});

test.describe("ключ API", () => {
  test("непринятый ключ объясняется отдельно и без самого ключа", async ({ page }) => {
    const serverErrors = watchServerErrors(page);

    await page.goto("/");
    await start(page, BAD_KEY_CHANNEL);

    await expect(page.getByText(/Ключ YouTube API не принят/)).toBeVisible();

    // Ключ не должен попасть на страницу ни при каком отказе.
    const text = await page.locator("body").innerText();
    expect(text).not.toContain(E2E_KEY);

    expect(serverErrors()).toEqual([]);
  });
});

test.describe("строка состояния сервиса", () => {
  test("видна сразу при открытии, до всякой выгрузки", async ({ page }) => {
    await page.goto("/");

    const banner = page.locator("#service-status");
    await expect(banner).toBeVisible();
    // Состояние названо словом, а не одним цветом.
    await expect(banner).toHaveText(/Готов|Внимание|Не работает/);
    await expect(banner).toContainText("Квота:");
  });

  test("после удачной выгрузки говорит, что сервис работает", async ({ page }) => {
    await page.goto("/");
    await start(page, GOOD_CHANNEL);

    await expect(page.locator("tbody tr")).toHaveCount(10, { timeout: 60_000 });

    const banner = page.locator("#service-status");
    await expect(banner).toHaveAttribute("data-tone", "ok");
    await expect(banner).toContainText("Готов");
  });

  test("расход квоты растёт по ходу работы", async ({ page }) => {
    await page.goto("/");

    const before = await spentQuota(page);

    await start(page, GOOD_CHANNEL);
    await expect(page.locator("tbody tr")).toHaveCount(10, { timeout: 60_000 });

    // Счётчик обновляется вместе с прогрессом, без перезагрузки страницы.
    await expect.poll(() => spentQuota(page)).toBeGreaterThan(before);
  });
});
