import { expect, test } from "@playwright/test";

/**
 * Заголовки безопасности.
 *
 * Проверяются по настоящему ответу сервера, а не по содержимому конфига:
 * заголовок, описанный в `next.config.ts`, но не доехавший до браузера,
 * защищает ровно ни от чего.
 */

/** Статические заголовки живут в `next.config.ts`. */
const STATIC_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
];

test.describe("заголовки безопасности", () => {
  test("страница отдаётся с полным набором", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    for (const [name, value] of STATIC_HEADERS) {
      expect(headers[name], `заголовок ${name}`).toBe(value);
    }

    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
  });

  test("CSP запрещает чужие источники и фреймы", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  test("скрипты пускаются по одноразовому nonce, а не скопом", async ({ page }) => {
    const first = (await page.goto("/"))?.headers()["content-security-policy"] ?? "";
    const second = (await page.goto("/?x=1"))?.headers()["content-security-policy"] ?? "";

    const nonceOf = (csp: string): string => /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";

    expect(nonceOf(first)).not.toBe("");
    // Угаданный nonce — это отсутствующий nonce, поэтому он свой на каждый ответ.
    expect(nonceOf(first)).not.toBe(nonceOf(second));

    // script-src без 'unsafe-inline': ради этого nonce и заведён.
    const scriptSrc = /script-src ([^;]+)/.exec(first)?.[1] ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).toContain("strict-dynamic");
  });

  test("nonce из заголовка проставлен скриптам страницы", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";

    // Без этого строгий CSP просто убил бы гидратацию — страница осталась бы
    // мёртвой разметкой.
    const scripts = await page.locator(`script[nonce]`).count();
    expect(nonce).not.toBe("");
    expect(scripts).toBeGreaterThan(0);

    await expect(page.getByRole("button", { name: "Начать" })).toBeEnabled();
  });

  test("страница жива при строгом CSP: ошибок в консоли нет", async ({ page }) => {
    // Нарушение CSP браузер пишет в консоль. Если что-то заблокировано,
    // видно будет именно здесь.
    const blocked: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
        blocked.push(message.text());
      }
    });

    await page.goto("/");
    await page.getByLabel("Адрес канала").fill("https://www.youtube.com/@e2e");
    await page.getByRole("button", { name: "Начать" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(50, { timeout: 60_000 });

    expect(blocked).toEqual([]);
  });
});
