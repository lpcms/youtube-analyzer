/**
 * Выгрузка таблицы в Excel.
 *
 * Обычный маршрут, а не серверное действие: скачивание файла — это ответ
 * с Content-Disposition, и браузер умеет его сам. Ссылка работает даже
 * без JavaScript и не тащит в страницу ни байта библиотеки.
 */

import { contentDisposition } from "@/lib/export/file-name";
import { exportRun } from "@/lib/export/export-run";
import { parseSort } from "@/lib/sorting";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fail(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const runId = params.get("run");
  if (runId === null || runId === "") return fail("Не указана выгрузка", 400);

  // Порядок тот же, что выбран в таблице: файл должен повторять то,
  // что человек видит на экране, а не приходить со своим умолчанием.
  const sort = parseSort(params.get("column"), params.get("direction"));

  const result = await exportRun(runId, { sort });
  if (!result.ok) return fail("Выгрузка не найдена", 404);

  return new Response(result.file, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": contentDisposition(result.fileName, result.fetchedAt),
      "Content-Length": String(result.file.byteLength),
      // Эта выгрузка — снимок и больше не изменится, но кэшировать файл
      // всё равно незачем: его скачивают один раз.
      "Cache-Control": "no-store",
    },
  });
}
