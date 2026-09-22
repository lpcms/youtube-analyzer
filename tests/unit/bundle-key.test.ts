/**
 * @vitest-environment node
 *
 * Проверка утечки ключа сама нуждается в проверке. Сканер, который никогда
 * ничего не находит, хуже отсутствующего: он выдаёт спокойствие, ничего
 * не проверив. Поэтому тест начинается с положительного случая — утечку
 * надо сначала поймать, и только потом верить чистому ответу.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error — скрипт сборочный, на JS и без деклараций типов.
import { MIN_SECRET_LENGTH, findSecrets } from "../../scripts/check-bundle-key.mjs";

const KEY = "AIzaSyD-ПоддельныйКлючДляТеста-0123456789";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "yt-bundle-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function chunk(name: string, content: string): Promise<void> {
  const full = path.join(dir, name);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("поиск ключа в клиентском бандле", () => {
  it("находит ключ, попавший в бандл", async () => {
    await chunk("chunks/app.js", `const k="${KEY}";fetch("/x?key="+k)`);

    const leaks = await findSecrets(dir, { YOUTUBE_API_KEY: KEY });

    expect(leaks).toHaveLength(1);
    expect(leaks[0].secretName).toBe("YOUTUBE_API_KEY");
  });

  it("находит ключ во вложенном каталоге, а не только в корне", async () => {
    await chunk("chunks/app/deep/page.js", `x=${JSON.stringify(KEY)}`);

    expect(await findSecrets(dir, { YOUTUBE_API_KEY: KEY })).toHaveLength(1);
  });

  it("имя переменной за утечку не считает", async () => {
    // Оно попадает в бандл законно: сообщение «проверьте YOUTUBE_API_KEY
    // в файле .env» показывается пользователю, и переменную надо назвать.
    await chunk("chunks/app.js", '"Проверьте YOUTUBE_API_KEY в файле .env"');

    expect(await findSecrets(dir, { YOUTUBE_API_KEY: KEY })).toEqual([]);
  });

  it("чистый бандл проходит", async () => {
    await chunk("chunks/app.js", 'console.log("ничего секретного")');
    await chunk("css/styles.css", "body{margin:0}");

    expect(await findSecrets(dir, { YOUTUBE_API_KEY: KEY })).toEqual([]);
  });

  it("слишком короткий секрет не ищется вовсе", async () => {
    // «abc» нашлось бы в любом бандле случайно, и проверка превратилась бы
    // в генератор ложных тревог.
    await chunk("chunks/app.js", "const abc=1");

    expect(await findSecrets(dir, { YOUTUBE_API_KEY: "abc" })).toEqual([]);
    expect(MIN_SECRET_LENGTH).toBeGreaterThan(8);
  });

  it("пустое значение ключа не объявляет утечкой весь бандл", async () => {
    // Пустая строка содержится в любом файле: без отсечки сканер ругался бы
    // на всё подряд.
    await chunk("chunks/app.js", "любой текст");

    expect(await findSecrets(dir, { YOUTUBE_API_KEY: "" })).toEqual([]);
  });
});
