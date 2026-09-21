import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import Database from "better-sqlite3";

const DB_FILE = "db/e2e.db";

/**
 * Готовит отдельную базу для E2E.
 *
 * Прогон не должен писать в dev.db: после него там остались бы строки
 * из заглушки, и рабочая база перестала бы отражать настоящие выгрузки.
 */
export default function globalSetup(): void {
  mkdirSync("db", { recursive: true });

  // Через process.execPath, а не npx: .cmd на Windows не запускается без shell.
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve("prisma/build/index.js");

  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:./${DB_FILE}` },
    stdio: "inherit",
  });

  // Чистим содержимое, а не удаляем файл. Дев-сервер между прогонами
  // переиспользуется и держит базу открытой: удалённый файл он всё равно
  // не отпустит, и выгрузки начнут падать на ровном месте.
  // Порядок — от зависимых к справочникам.
  const db = new Database(DB_FILE);
  try {
    for (const table of ["VideoStat", "FetchRun", "Video", "Channel"]) {
      db.prepare(`DELETE FROM "${table}"`).run();
    }
  } finally {
    db.close();
  }
}
