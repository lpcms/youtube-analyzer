import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TablePager } from "@/app/table-pager";
import type { PageSize, PageSpec } from "@/lib/pagination";

/**
 * Панель выводится дважды — над таблицей и под ней. Модульные тесты
 * показывают по одной, нижней; про различия между местами — отдельный describe.
 */

function pager(
  spec: PageSpec,
  pageCount: number,
  total: number,
  place: "top" | "bottom" = "bottom",
) {
  const onPage = vi.fn<(page: number) => void>();
  const onPageSize = vi.fn<(size: PageSize) => void>();
  render(
    <TablePager
      place={place}
      spec={spec}
      pageCount={pageCount}
      total={total}
      onPage={onPage}
      onPageSize={onPageSize}
    />,
  );
  return { onPage, onPageSize };
}

describe("подпись о строках", () => {
  it("называет диапазон и общее число", () => {
    pager({ page: 2, pageSize: 20 }, 7, 137);

    expect(screen.getByText(/21–40/)).toBeInTheDocument();
    expect(screen.getByText("137")).toBeInTheDocument();
  });

  it("пустая выгрузка сообщает об этом словами", () => {
    pager({ page: 1, pageSize: 50 }, 1, 0);

    expect(screen.getByText("Нет строк")).toBeInTheDocument();
  });
});

describe("переключение страниц", () => {
  it("номер текущей страницы и общее число видны", () => {
    pager({ page: 2, pageSize: 50 }, 3, 137);

    const nav = screen.getByRole("navigation", { name: "Страницы таблицы, снизу" });
    expect(nav).toHaveTextContent("Страница 2 из 3");
  });

  it("кнопки ведут на соседние страницы", async () => {
    const user = userEvent.setup();
    const { onPage } = pager({ page: 2, pageSize: 50 }, 3, 137);

    await user.click(screen.getByRole("button", { name: /Вперёд/ }));
    expect(onPage).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: /Назад/ }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("на первой странице «Назад» недоступна, на последней — «Вперёд»", () => {
    const { unmount } = render(
      <TablePager
        place="bottom"
        spec={{ page: 1, pageSize: 50 }}
        pageCount={3}
        total={137}
        onPage={vi.fn()}
        onPageSize={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Назад/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Вперёд/ })).toBeEnabled();
    unmount();

    pager({ page: 3, pageSize: 50 }, 3, 137);
    expect(screen.getByRole("button", { name: /Назад/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Вперёд/ })).toBeDisabled();
  });

  it("переключение работает с клавиатуры", async () => {
    const user = userEvent.setup();
    const { onPage } = pager({ page: 2, pageSize: 50 }, 3, 137);

    screen.getByRole("button", { name: /Вперёд/ }).focus();
    await user.keyboard("{Enter}");

    expect(onPage).toHaveBeenCalledWith(3);
  });

  it("выгрузка на одну страницу не показывает бессмысленный переключатель", () => {
    pager({ page: 1, pageSize: 50 }, 1, 12);

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: /Вперёд/ })).toBeNull();
    // Число строк всё равно сообщается.
    expect(screen.getByText(/1–12/)).toBeInTheDocument();
  });
});

describe("размер страницы", () => {
  it("выбирается из списка", async () => {
    const user = userEvent.setup();
    const { onPageSize } = pager({ page: 1, pageSize: 50 }, 3, 137);

    await user.selectOptions(screen.getByLabelText("Строк на странице"), "25");

    expect(onPageSize).toHaveBeenCalledWith(25);
  });

  it("текущий размер отмечен", () => {
    pager({ page: 1, pageSize: 100 }, 2, 137);

    expect(screen.getByLabelText("Строк на странице")).toHaveValue("100");
  });

  it("выбор не предлагается, когда строк меньше самого мелкого размера", () => {
    pager({ page: 1, pageSize: 50 }, 1, 12);

    expect(screen.queryByLabelText("Строк на странице")).toBeNull();
  });
});

describe("две панели на странице", () => {
  /**
   * Панель стоит и над таблицей, и под ней. Всё, что на странице должно быть
   * в единственном экземпляре, обязано различаться — иначе разметка невалидна,
   * а скринридер не отличит одну панель от другой.
   */
  function bothPlaces(): void {
    render(
      <>
        <TablePager
          place="top"
          spec={{ page: 2, pageSize: 50 }}
          pageCount={3}
          total={137}
          onPage={vi.fn()}
          onPageSize={vi.fn()}
        />
        <TablePager
          place="bottom"
          spec={{ page: 2, pageSize: 50 }}
          pageCount={3}
          total={137}
          onPage={vi.fn()}
          onPageSize={vi.fn()}
        />
      </>,
    );
  }

  it("счётчик строк и выбор размера не делят один id", () => {
    bothPlaces();

    const ids = screen.getAllByText(/Строки/).map((el) => el.id);
    expect(ids).toEqual(["row-count-top", "row-count-bottom"]);

    const selects = screen.getAllByLabelText("Строк на странице").map((el) => el.id);
    expect(selects).toEqual(["pageSize-top", "pageSize-bottom"]);
    expect(new Set(selects).size).toBe(2);
  });

  it("каждая навигация названа своим местом", () => {
    bothPlaces();

    expect(
      screen.getByRole("navigation", { name: "Страницы таблицы, сверху" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Страницы таблицы, снизу" })).toBeInTheDocument();
  });

  it("смену страницы объявляет только верхняя панель", () => {
    bothPlaces();

    // Иначе скринридер произнесёт «Страница 2 из 3» дважды подряд.
    const live = screen
      .getAllByText(/Страница/)
      .map((el) => el.getAttribute("aria-live"))
      .filter((value) => value === "polite");

    expect(live).toHaveLength(1);
  });

  it("обе панели показывают одно и то же", () => {
    bothPlaces();

    const [top, bottom] = screen.getAllByText(/Строки/);
    expect(top?.textContent).toBe(bottom?.textContent);

    const pages = screen.getAllByText(/Страница/).map((el) => el.textContent);
    expect(pages[0]).toBe(pages[1]);
  });
});
