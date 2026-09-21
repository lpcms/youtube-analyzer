import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VideoTable } from "@/app/video-table";
import type { VideoRow } from "@/lib/fetch-channel";
import { DEFAULT_SORT, type SortColumn, type SortSpec } from "@/lib/sorting";

/** Таблица с сортировкой по умолчанию, если тесту не важно иное. */
function show(rows: readonly VideoRow[], sort: SortSpec = DEFAULT_SORT) {
  const onSort = vi.fn<(column: SortColumn) => void>();
  const result = render(<VideoTable rows={rows} sort={sort} onSort={onSort} />);
  return { ...result, onSort };
}

const HEADERS = [
  "URL",
  "Тип",
  "Длительность",
  "Просмотры",
  "Лайки",
  "Комментарии",
  "Вирусность",
  "Дата",
  "Описание",
];

function row(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: "dQw4w9WgXcQ",
    title: "Заголовок",
    kind: "VIDEO",
    kindAssumed: false,
    durationSec: 3723,
    publishedAt: new Date(Date.UTC(2026, 8, 21, 14, 21)),
    description: "Описание",
    viewCount: 1_234_567,
    likeCount: 500,
    commentCount: 0,
    viralityScore: 12.34,
    ...overrides,
  };
}

describe("колонки таблицы", () => {
  it("все девять из ТЗ, в нужном порядке", () => {
    show([row()]);

    // Стрелка направления декоративная (aria-hidden), в названии колонки
    // её быть не должно.
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.replace(/[↑↓]/g, "").trim());
    expect(headers).toEqual(HEADERS);
  });

  it("значения выводятся в заданных форматах", () => {
    show([row()]);

    expect(screen.getByText("1:02:03")).toBeInTheDocument();
    expect(screen.getByText("2026-09-21 14:21")).toBeInTheDocument();
    expect(screen.getByText("1 234 567")).toBeInTheDocument();
    expect(screen.getByText("12,3")).toBeInTheDocument();
  });

  it("ноль комментариев остаётся нулём, скрытые лайки — «н/д»", () => {
    show([row({ likeCount: null, commentCount: 0 })]);

    const cells = screen.getAllByRole("cell");
    // Порядок ячеек: Тип, Длительность, Просмотры, Лайки, Комментарии, ...
    expect(cells[3]).toHaveTextContent("н/д");
    expect(cells[4]).toHaveTextContent("0");
  });

  it("непосчитанная вирусность — «н/д», а не ноль", () => {
    show([row({ viralityScore: null })]);

    expect(screen.getAllByText("н/д")).toHaveLength(1);
  });
});

describe("ссылка на видео", () => {
  it("ведёт на страницу просмотра и открывается в новой вкладке", () => {
    show([row()]);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("описание", () => {
  it("выводится как текст: разметка внутри не исполняется", () => {
    const dangerous = '<img src=x onerror="alert(1)"><b>жирный</b>';
    const { container } = show([row({ description: dangerous })]);

    // Тег остался видимым текстом, а не превратился в элемент.
    expect(screen.getByText(dangerous)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("видео без описания даёт пустую ячейку", () => {
    show([row({ description: "" })]);

    const cells = screen.getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveTextContent("—");
  });

  it("длинное сокращается, но полный текст доступен", () => {
    const long = "Начало описания. " + "текст ".repeat(60);
    show([row({ description: long })]);

    // Сокращённый вид виден сразу.
    expect(screen.getByText(/Начало описания\..*…$/)).toBeInTheDocument();
    // Полный текст присутствует в разметке и раскрывается details —
    // это работает с клавиатуры и без JavaScript.
    expect(screen.getByText(long.trim())).toBeInTheDocument();
    expect(screen.getByRole("group")).toBeInTheDocument();
  });
});

describe("семантика разметки", () => {
  it("заголовки колонок имеют scope", () => {
    show([row()]);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("ссылка — опознавательная ячейка строки", () => {
    show([row()]);

    const rowHeader = screen.getByRole("rowheader");
    expect(rowHeader).toHaveAttribute("scope", "row");
    expect(within(rowHeader).getByRole("link")).toBeInTheDocument();
  });

  it("у таблицы есть подпись для скринридера", () => {
    show([row()]);

    expect(screen.getByRole("table", { name: /Видео канала/ })).toBeInTheDocument();
  });
});

describe("пустая выгрузка", () => {
  it("объясняет, а не показывает пустую таблицу", () => {
    show([]);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("У этого канала нет видео.")).toBeInTheDocument();
  });
});

describe("сортировка в заголовках", () => {
  const SORTABLE = [
    "Тип",
    "Длительность",
    "Просмотры",
    "Лайки",
    "Комментарии",
    "Вирусность",
    "Дата",
  ];

  it("сортируемые колонки — кнопки, URL и Описание — нет", () => {
    show([row()]);

    for (const label of SORTABLE) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^URL/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Описание/ })).toBeNull();
  });

  it("направление видно скринридеру через aria-sort", () => {
    show([row()], { column: "viewCount", direction: "desc" });

    const views = screen.getByRole("columnheader", { name: /Просмотры/ });
    expect(views).toHaveAttribute("aria-sort", "descending");

    // У остальных сортируемых — «none», у несортируемых атрибута нет вовсе.
    const likes = screen.getByRole("columnheader", { name: /Лайки/ });
    expect(likes).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("columnheader", { name: "URL" })).not.toHaveAttribute("aria-sort");
  });

  it("возрастающий порядок объявляется как ascending", () => {
    show([row()], { column: "durationSec", direction: "asc" });

    expect(screen.getByRole("columnheader", { name: /Длительность/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("клик по заголовку сообщает колонку", async () => {
    const user = userEvent.setup();
    const { onSort } = show([row()]);

    await user.click(screen.getByRole("button", { name: /Просмотры/ }));

    expect(onSort).toHaveBeenCalledWith("viewCount");
  });

  it("сортировка доступна с клавиатуры", async () => {
    const user = userEvent.setup();
    const { onSort } = show([row()]);

    screen.getByRole("button", { name: /Лайки/ }).focus();
    await user.keyboard("{Enter}");

    expect(onSort).toHaveBeenCalledWith("likeCount");
  });
});

describe("первая колонка", () => {
  it("под ссылкой показано название ролика", () => {
    show([row({ title: "Как я построил дом за 24 часа" })]);

    const rowHeader = screen.getByRole("rowheader");
    expect(within(rowHeader).getByRole("link")).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(rowHeader).toHaveTextContent("Как я построил дом за 24 часа");
  });

  it("длинное название не рвёт вёрстку, но доступно целиком", () => {
    const long = "Очень длинное название ролика, ".repeat(6);
    show([row({ title: long })]);

    // Обрезается стилями, поэтому полный текст остаётся в атрибуте title.
    const rowHeader = screen.getByRole("rowheader");
    const caption = rowHeader.querySelector("[title]");
    expect(caption).toHaveAttribute("title", long);
  });

  it("название выводится как текст: разметка не исполняется", () => {
    const { container } = show([row({ title: "<b>жирный</b>" })]);

    expect(screen.getByText("<b>жирный</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});
