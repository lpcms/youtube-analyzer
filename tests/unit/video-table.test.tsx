import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoTable } from "@/app/video-table";
import type { VideoRow } from "@/lib/fetch-channel";

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
    render(<VideoTable rows={[row()]} />);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(HEADERS);
  });

  it("значения выводятся в заданных форматах", () => {
    render(<VideoTable rows={[row()]} />);

    expect(screen.getByText("1:02:03")).toBeInTheDocument();
    expect(screen.getByText("2026-09-21 14:21")).toBeInTheDocument();
    expect(screen.getByText("1 234 567")).toBeInTheDocument();
    expect(screen.getByText("12,3")).toBeInTheDocument();
  });

  it("ноль комментариев остаётся нулём, скрытые лайки — «н/д»", () => {
    render(<VideoTable rows={[row({ likeCount: null, commentCount: 0 })]} />);

    const cells = screen.getAllByRole("cell");
    // Порядок ячеек: Тип, Длительность, Просмотры, Лайки, Комментарии, ...
    expect(cells[3]).toHaveTextContent("н/д");
    expect(cells[4]).toHaveTextContent("0");
  });

  it("непосчитанная вирусность — «н/д», а не ноль", () => {
    render(<VideoTable rows={[row({ viralityScore: null })]} />);

    expect(screen.getAllByText("н/д")).toHaveLength(1);
  });
});

describe("ссылка на видео", () => {
  it("ведёт на страницу просмотра и открывается в новой вкладке", () => {
    render(<VideoTable rows={[row()]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("описание", () => {
  it("выводится как текст: разметка внутри не исполняется", () => {
    const dangerous = '<img src=x onerror="alert(1)"><b>жирный</b>';
    const { container } = render(<VideoTable rows={[row({ description: dangerous })]} />);

    // Тег остался видимым текстом, а не превратился в элемент.
    expect(screen.getByText(dangerous)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("видео без описания даёт пустую ячейку", () => {
    render(<VideoTable rows={[row({ description: "" })]} />);

    const cells = screen.getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveTextContent("—");
  });

  it("длинное сокращается, но полный текст доступен", () => {
    const long = "Начало описания. " + "текст ".repeat(60);
    render(<VideoTable rows={[row({ description: long })]} />);

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
    render(<VideoTable rows={[row()]} />);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("ссылка — опознавательная ячейка строки", () => {
    render(<VideoTable rows={[row()]} />);

    const rowHeader = screen.getByRole("rowheader");
    expect(rowHeader).toHaveAttribute("scope", "row");
    expect(within(rowHeader).getByRole("link")).toBeInTheDocument();
  });

  it("у таблицы есть подпись для скринридера", () => {
    render(<VideoTable rows={[row()]} />);

    expect(screen.getByRole("table", { name: /Видео канала/ })).toBeInTheDocument();
  });
});

describe("пустая выгрузка", () => {
  it("объясняет, а не показывает пустую таблицу", () => {
    render(<VideoTable rows={[]} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("У этого канала нет видео.")).toBeInTheDocument();
  });
});
