import { expect, test } from "@playwright/test";

test("стартовая страница отвечает и отрисовывается", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
