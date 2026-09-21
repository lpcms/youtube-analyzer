import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Playwright ходит на 127.0.0.1, а дев-сервер Next по умолчанию считает
  // такой хост посторонним и блокирует свои dev-ресурсы. На прод не влияет.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
