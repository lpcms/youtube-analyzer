/**
 * Знак сервиса.
 *
 * Один и тот же рисунок живёт в двух местах: в `logo.tsx` — для шапки
 * страницы, в `icon.svg` — для вкладки браузера. Разъехавшийся знак глазами
 * почти не заметить: вкладка мелкая, а страница перед глазами всё время.
 * Поэтому совпадение стережёт тест.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOGO_BACKGROUND, LOGO_PATH, Logo } from "@/app/logo";

const iconSvg = readFileSync(path.join(process.cwd(), "src/app/icon.svg"), "utf8");

describe("знак сервиса", () => {
  it("во вкладке браузера тот же рисунок, что и в шапке страницы", () => {
    expect(iconSvg).toContain(LOGO_PATH);
    expect(iconSvg).toContain(LOGO_BACKGROUND);
  });

  it("рисуется линиями, а не буквой из шрифта", () => {
    // Текст в SVG зависит от шрифтов машины, и знак поехал бы у половины
    // зрителей.
    expect(iconSvg).not.toMatch(/<text/);
    expect(iconSvg).toMatch(/viewBox="0 0 24 24"/);
  });

  it("остаётся лёгким: значок грузится на каждой странице", () => {
    expect(iconSvg.length).toBeLessThan(1024);
  });

  it("в шапке страницы не озвучивается скринридером", () => {
    // Рядом стоит заголовок, и знак повторял бы его другими словами.
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.querySelector("path")).toHaveAttribute("d", LOGO_PATH);
  });
});
