import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TablePager } from "@/app/table-pager";
import type { PageSize, PageSpec } from "@/lib/pagination";

function pager(spec: PageSpec, pageCount: number, total: number) {
  const onPage = vi.fn<(page: number) => void>();
  const onPageSize = vi.fn<(size: PageSize) => void>();
  render(
    <TablePager
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

    const nav = screen.getByRole("navigation", { name: "Страницы таблицы" });
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
