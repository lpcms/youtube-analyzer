import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Анализатор YouTube-каналов",
  description:
    "Таблица Video и Shorts канала с просмотрами, лайками, комментариями и оценкой вирусности.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
