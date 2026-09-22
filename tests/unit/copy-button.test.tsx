import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "@/app/copy-button";

/**
 * Кнопка копирования.
 *
 * Буфер обмена — внешняя система, и в jsdom его нет вовсе. Подменяем его
 * целиком: проверять надо, что кнопка кладёт туда правильное значение
 * и что она переживает отказ, а не то, как устроен буфер в браузере.
 */

function withClipboard(writeText: (value: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("кнопка копирования", () => {
  it("кладёт значение в буфер обмена", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    withClipboard(writeText);

    render(
      <CopyButton
        value="https://www.youtube.com/watch?v=aaaaaaaaaaa"
        kind="link"
        label="Скопировать ссылку на видео"
      />,
    );
    await userEvent.click(screen.getByRole("button"));

    expect(writeText).toHaveBeenCalledWith("https://www.youtube.com/watch?v=aaaaaaaaaaa");
  });

  it("подтверждает копирование подписью, а не только значком", async () => {
    // Значок скринридеру не виден, поэтому меняется и подпись.
    withClipboard(vi.fn().mockResolvedValue(undefined));

    render(<CopyButton value="Название ролика" kind="text" label="Скопировать название видео" />);
    await userEvent.click(screen.getByRole("button", { name: "Скопировать название видео" }));

    expect(await screen.findByRole("button", { name: "Скопировано" })).toBeInTheDocument();
  });

  it("недоступный буфер не ломает строку таблицы", async () => {
    // Буфер бывает закрыт: не тот протокол, отказано в праве. Строка обязана
    // пережить это молча — значение всё ещё видно глазами.
    withClipboard(vi.fn().mockRejectedValue(new Error("не разрешено")));

    render(<CopyButton value="что-нибудь" kind="link" label="Скопировать ссылку на видео" />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    expect(button).toHaveAccessibleName("Скопировать ссылку на видео");
  });

  it("подтверждение само уходит, а не остаётся навсегда", async () => {
    // Часы настоящие: поддельные вместе с user-event подвешивают клик,
    // а полторы секунды один раз за прогон дешевле такой возни.
    withClipboard(vi.fn().mockResolvedValue(undefined));

    render(<CopyButton value="что-нибудь" kind="link" label="Скопировать ссылку на видео" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeInTheDocument();

    await screen.findByRole("button", { name: "Скопировать ссылку на видео" }, { timeout: 3000 });
  });
});
