import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const databaseUrl = process.env["DATABASE_URL"] ?? "file:./db/dev.db";

function createClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

// В dev-режиме Next перезагружает модули на каждое изменение. Без глобального
// хранения это плодило бы по клиенту на перезагрузку и упёрлось бы в лимит
// подключений.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
