import { listChannels } from "@/lib/channel-history";
import { readServiceHealth } from "@/lib/service-status";
import { ChannelForm } from "./channel-form";
import { Logo } from "./logo";

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
      <div className="mb-4 flex items-center gap-3">
        <Logo className="size-9 shrink-0" />
        <div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">
            Анализатор YouTube-каналов
          </h1>
          <p className="text-sm opacity-70">
            Вставьте адрес канала — сервис соберёт таблицу его видео.
          </p>
        </div>
      </div>
      <ChannelForm health={health} channels={channels} />
    </main>
  );
}
