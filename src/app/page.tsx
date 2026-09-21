import { ChannelForm } from "./channel-form";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Анализатор YouTube-каналов</h1>
      <p className="mb-6 text-sm opacity-70">
        Вставьте адрес канала — сервис соберёт таблицу его видео.
      </p>
      <ChannelForm />
    </main>
  );
}
