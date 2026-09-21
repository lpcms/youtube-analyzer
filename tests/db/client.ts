import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

/// Отдельный от src/lib/prisma.ts клиент: тестовый никогда не должен смотреть
/// в dev.db, иначе упавший тест сотрёт рабочие данные.
export const testDbUrl = "file:./db/test.db";

export const testPrisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: testDbUrl }),
});
