import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

/// Накатывает миграции на тестовую базу один раз за прогон.
///
/// Схема накатывается миграциями, а не `db push`: тест должен проверять ту же
/// структуру, что поедет в прод.
///
/// `prisma migrate deploy` не принимает `--url` (в отличие от `migrate dev`)
/// и берёт адрес из prisma7.config.ts, а тот читает DATABASE_URL. Переопределяем
/// переменной окружения дочернего процесса: dotenv не перезаписывает уже
/// заданные переменные, поэтому значение отсюда имеет приоритет над .env.
export default function setup(): void {
  // better-sqlite3 не создаёт папку сам.
  mkdirSync("db", { recursive: true });

  // CLI запускается напрямую через Node, а не через npx: на Windows npx —
  // это npx.cmd, а .cmd Node отказывается запускать без shell, тогда как
  // shell:true он же помечает небезопасным из-за неэкранированных аргументов.
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve("prisma/build/index.js");

  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: "file:./db/test.db" },
    stdio: "inherit",
  });
}
