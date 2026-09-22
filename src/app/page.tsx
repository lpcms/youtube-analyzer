import { listChannels } from "@/lib/channel-history";
import { readServiceHealth } from "@/lib/service-status";
import { ChannelForm } from "./channel-form";

/**
 * Страница отдаёт первый снимок живых данных — состояние сервиса и список
 * ранее выгруженных каналов. Дальше их обновляет сама форма, точечно:
 * пересборка всего сегмента задевала бы открытую таблицу.
 *
 * Данные живые, поэтому страница собирается на запрос, а не заранее.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const [health, channels] = await Promise.all([readServiceHealth(), listChannels()]);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Анализатор YouTube-каналов</h1>
      <p className="mb-4 text-sm opacity-70">
        Вставьте адрес канала — сервис соберёт таблицу его видео.
      </p>
      <ChannelForm health={health} channels={channels} />
    </main>
  );
}
