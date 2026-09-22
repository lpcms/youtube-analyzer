/**
 * Проверка: ключ YouTube API не попал в клиентский бандл.
 *
 * Ищется **значение** ключа, а не имя переменной. Имя встречается в бандле
 * законно — сообщение «проверьте YOUTUBE_API_KEY в файле .env» показывается
 * пользователю, и переменную в нём надо назвать. Утечка — это когда наружу
 * уходит сам ключ, и ловить надо именно её.
 *
 * Запускается по собранному проекту: `npm run build && npm run check:key`.
 * Сборки может не быть — тогда это не «проверка прошла», а отказ: молчаливое
 * «ок» на пустом месте хуже, чем его отсутствие.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Где лежит то, что уезжает в браузер. */
export const CLIENT_DIR = path.join(".next", "static");

/**
 * Короткую строку искать бессмысленно: «abc» найдётся в любом бандле
 * случайно, и проверка превратится в генератор ложных тревог.
 */
export const MIN_SECRET_LENGTH = 12;

/** Все файлы дерева, вместе с вложенными. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }

  return files;
}

/**
 * Ищет секреты в файлах каталога.
 *
 * Возвращает список находок `{ file, secretName }`. Пустой список — чисто.
 * Слишком короткие секреты пропускаются: искать их значит ловить совпадения,
 * а не утечки.
 */
export async function findSecrets(dir, secrets) {
  const hunted = Object.entries(secrets).filter(
    ([, value]) => typeof value === "string" && value.length >= MIN_SECRET_LENGTH,
  );
  if (hunted.length === 0) return [];

  const found = [];

  for (const file of await walk(dir)) {
    // Читаем как текст: бандл — это текст, а бинарное содержимое
    // при таком чтении просто не совпадёт ни с чем.
    const content = await readFile(file, "utf8").catch(() => "");
    for (const [name, value] of hunted) {
      if (content.includes(value)) found.push({ file, secretName: name });
    }
  }

  return found;
}

/** Читает `.env`, не подменяя уже заданные переменные окружения. */
async function readEnvFile(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  const values = {};

  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i.exec(line);
    if (match === null) continue;
    const [, name, raw] = match;
    if (name !== undefined && raw !== undefined) {
      values[name] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }

  return values;
}

async function main() {
  const exists = await stat(CLIENT_DIR).then(
    (s) => s.isDirectory(),
    () => false,
  );

  if (!exists) {
    console.error(`Нет сборки: каталога ${CLIENT_DIR} не существует.`);
    console.error("Сначала `npm run build`, потом эта проверка.");
    process.exit(2);
  }

  const fromFile = await readEnvFile(".env");
  const key = process.env["YOUTUBE_API_KEY"] ?? fromFile["YOUTUBE_API_KEY"] ?? "";

  if (key.length < MIN_SECRET_LENGTH) {
    console.error("Ключ YOUTUBE_API_KEY не найден или слишком короткий.");
    console.error("Проверять нечего, а молчаливое «ок» здесь хуже отказа.");
    process.exit(2);
  }

  const leaks = await findSecrets(CLIENT_DIR, { YOUTUBE_API_KEY: key });

  if (leaks.length > 0) {
    console.error("Ключ найден в клиентском бандле:");
    for (const leak of leaks) console.error(`  ${leak.file}`);
    process.exit(1);
  }

  console.log(`Значения YOUTUBE_API_KEY в ${CLIENT_DIR} нет.`);
}

// Запуск только как команды: при импорте из теста main дёргать не надо.
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
