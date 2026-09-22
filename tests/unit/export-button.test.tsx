import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExportButton } from "@/app/export-button";
import type { SortSpec } from "@/lib/sorting";

const SORT: SortSpec = { column: "viewCount", direction: "desc" };

function link(): HTMLAnchorElement {
  return screen.getByRole("link", { name: "Скачать таблицу" }) as HTMLAnchorElement;
}

describe("«Скачать таблицу»", () => {
  it("ведёт на выгрузку этого запуска в текущем порядке", () => {
    render(<ExportButton runId="run-42" sort={SORT} total={137} />);

    const href = link().getAttribute("href") ?? "";
    const query = new URLSearchParams(href.slice(href.indexOf("?")));

    expect(href.startsWith("/api/export?")).toBe(true);
    expect(query.get("run")).toBe("run-42");
    expect(query.get("column")).toBe("viewCount");
    expect(query.get("direction")).toBe("desc");
  });

  it("помечена как скачивание, а имя файла оставлено серверу", () => {
    render(<ExportButton runId="run-42" sort={SORT} total={137} />);

    // Пустой download: имя приходит в Content-Disposition — с названием
    // канала и датой. Своё значение здесь перебило бы его.
    expect(link()).toHaveAttribute("download", "");
  });

  it("не предлагается, когда скачивать нечего", () => {
    render(<ExportButton runId="run-42" sort={SORT} total={0} />);

    expect(screen.queryByRole("link", { name: "Скачать таблицу" })).toBeNull();
  });

  it("идентификатор выгрузки экранируется", () => {
    render(<ExportButton runId="a b&c" sort={SORT} total={1} />);

    const href = link().getAttribute("href") ?? "";
    expect(href).toContain("run=a+b%26c");
    expect(new URLSearchParams(href.slice(href.indexOf("?"))).get("run")).toBe("a b&c");
  });
});
