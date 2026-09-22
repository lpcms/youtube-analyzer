/**
 * Сбор состояния сервиса из того, что уже известно.
 *
 * Ни одного обращения к YouTube: ключ — переменная окружения, последняя
 * выгрузка — строка в базе, расход квоты — счётчик процесса. Проверять связь
 * настоящим запросом значило бы тратить квоту на каждое открытие страницы,
 * а при исчерпанной квоте — ещё и получать отказ вместо ответа.
 */

import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { FetchStatus } from "@/lib/job-status";
import type { ServiceHealth } from "@/lib/service-health";
import { quotaSpent } from "@/lib/youtube/api";

export interface ReadHealthOptions {
  readonly prisma?: PrismaClient;
  /**
   * Уже известная последняя выгрузка. Во время опроса прогресса она под рукой,
   * и лишний запрос к базе на каждые полсекунды ни к чему.
   */
  readonly lastRun?: { readonly status: FetchStatus; readonly errorReason: string | null };
}

export async function readServiceHealth(options: ReadHealthOptions = {}): Promise<ServiceHealth> {
  const db = options.prisma ?? defaultPrisma;

  const key = process.env["YOUTUBE_API_KEY"];
  const keyConfigured = key !== undefined && key !== "";

  if (options.lastRun !== undefined) {
    return { keyConfigured, lastRun: options.lastRun, quotaSpent: quotaSpent() };
  }

  const run = await db.fetchRun.findFirst({ orderBy: { startedAt: "desc" } });

  return {
    keyConfigured,
    lastRun:
      run === null ? null : { status: run.status as FetchStatus, errorReason: run.errorReason },
    quotaSpent: quotaSpent(),
  };
}
