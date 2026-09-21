import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

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
    env: { ...process.env, DATABASE_URL: "file:./db/e2e.db" },
    stdio: "inherit",
  });
}
