/**
 * @vitest-environment node
 *
 * README обещает команды и файлы. Обещание, которое никто не проверяет,
 * протухает первым: команду переименовали — и человек, разворачивающий
 * проект по инструкции, упирается в «Missing script».
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

const readme = readFileSync(path.join(root, "README.md"), "utf8");
const claudeMd = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
const scripts = Object.keys(
  (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: object })
    .scripts,
);

/** Встроенные команды npm: их в package.json искать незачем. */
const BUILTIN = new Set(["install", "ci", "audit", "init", "exec"]);

/**
 * Все `npm …`, упомянутые в тексте.
 *
 * «run» необязателен: `npm test` и `npm start` пишутся без него, но это
 * такие же скрипты из package.json. Цифры в имени обязательны — без них
 * `test:e2e` обрезалось бы до `test:e`.
 */
function npmCommands(text: string): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(/npm (?:run )?([a-z0-9:]+)/g)) {
    const name = match[1];
    if (name !== undefined && !BUILTIN.has(name)) found.add(name);
  }

  return [...found].sort();
}

describe("README", () => {
  it("не обещает команд, которых нет в package.json", () => {
    const promised = npmCommands(readme);

    expect(promised.length).toBeGreaterThan(10);
    expect(promised.filter((name) => !scripts.includes(name))).toEqual([]);
  });

  it("перечисляет все команды из CLAUDE.md", () => {
    // CLAUDE.md — свод правил для работы над проектом, README — инструкция
    // для того, кто его разворачивает. Команды у них обязаны совпадать.
    const expected = npmCommands(claudeMd);

    expect(expected.length).toBeGreaterThan(10);
    expect(expected.filter((name) => !readme.includes(`npm run ${name}`))).toEqual([]);
  });

  it("ссылается только на существующие файлы репозитория", () => {
    const links = [...readme.matchAll(/\]\((?!https?:)([^)#]+)/g)].map((m) => m[1] ?? "");

    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((link) => !existsSync(path.join(root, link)))).toEqual([]);
  });

  it("называет переменные окружения теми же именами, что и .env.example", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    const names = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1] ?? "");

    expect(names).toContain("YOUTUBE_API_KEY");
    for (const name of names) expect(readme).toContain(name);
  });

  it("не подсказывает префикс NEXT_PUBLIC_ для ключа", () => {
    // Он утащил бы ключ в клиентский бандл. README обязан предупреждать
    // об этом, а не показывать как вариант.
    expect(readme).not.toMatch(/NEXT_PUBLIC_YOUTUBE/);
    expect(readme).toContain("без префикса `NEXT_PUBLIC_`");
  });

  it("объясняет отсутствие дизлайков и значение 10,0 у вирусности", () => {
    // Оба места — источник вопросов «это недоделка?» у того, кто видит
    // сервис впервые.
    expect(readme).toContain("ДизЛайки");
    expect(readme).toMatch(/10,0 — типичное видео/);
  });
});
